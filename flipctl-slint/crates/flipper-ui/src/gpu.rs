//! A hosted app's frame turned into a panel frame by the GPU.
//!
//! The CPU path reads the whole capture and writes the panel's greyscale: 256KB in,
//! 36KB out, measured at 12ms of every 28.6ms frame, which made it the limit on how
//! fast a hosted app could be shown. None of that work is ours to do. The compositor
//! already has the frame in a GPU buffer; scaling is what a sampler does for free, and
//! the luma is one dot product.
//!
//! So a buffer is allocated here with GBM in the format the compositor asks for, handed
//! to it to copy into, imported once as a texture, and sampled into a 256x144
//! single-channel target: only the 36KB the panel wants crosses to the CPU.
//!
//! Two things about this are worth knowing rather than rediscovering. The format has to
//! be the one screencopy names, because a `wl_buffer` the compositor will not take is a
//! *fatal* protocol error rather than a refusal, and GBM takes the fourcc as an
//! argument where exporting a GL texture gives whatever it gives. And a dmabuf import
//! can only be sampled through `samplerExternalOES`: a `sampler2D` compiles, links, and
//! reads black, which cost an evening of blaming the compositor.
//!
//! The first version of this took the compositor's own front buffer through
//! `zwlr_export_dmabuf`, which copies nothing at all and is deprecated for good
//! reason: the buffer is not ours, and wlroots recycles it for the next frame. The
//! pictures said so before the protocol did, with a clock whose seconds jumped about
//! and a game whose card looped. A copy into a buffer we own costs one GPU blit and
//! makes the frame ours by contract: screencopy's `ready` means the copy is finished.
//!
//! Everything here is loaded at runtime and lives behind the `gpu` feature: nothing in
//! the boot menu, the installer or recovery links EGL.

use std::ffi::{c_char, c_void, CStr};
use std::io;
use std::os::fd::{FromRawFd, OwnedFd};

use khronos_egl as egl;

/// One plane of the buffer we allocated, as EGL exported it.
pub struct Plane {
    pub fd: OwnedFd,
    pub offset: u32,
    pub stride: u32,
}

/// One buffer of the pair, and what it takes to sample it.
struct Buffer {
    bo: *mut c_void,
    image: egl::Image,
    size: (u32, u32),
}

/// The buffer the compositor is asked to copy into, described so Wayland can wrap it.
pub struct Target {
    pub planes: Vec<Plane>,
    pub fourcc: u32,
    pub modifier: u64,
    pub w: u32,
    pub h: u32,
}

const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_TEXTURE_MIN_FILTER: u32 = 0x2801;
const GL_TEXTURE_MAG_FILTER: u32 = 0x2800;
const GL_TEXTURE_WRAP_S: u32 = 0x2802;
const GL_TEXTURE_WRAP_T: u32 = 0x2803;
const GL_LINEAR: i32 = 0x2601;
const GL_NEAREST: i32 = 0x2600;
const GL_CLAMP_TO_EDGE: i32 = 0x812F;
const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: u32 = 0x8CD5;
const GL_R8: u32 = 0x8229;
/// A dmabuf is sampled through an external texture, not a plain one.
const GL_TEXTURE_EXTERNAL_OES: u32 = 0x8D65;
const GL_RED: u32 = 0x1903;
const GL_UNSIGNED_BYTE: u32 = 0x1401;
const GL_VERTEX_SHADER: u32 = 0x8B31;
const GL_FRAGMENT_SHADER: u32 = 0x8B30;
const GL_COMPILE_STATUS: u32 = 0x8B81;
const GL_LINK_STATUS: u32 = 0x8B82;
const GL_TRIANGLE_STRIP: u32 = 0x0005;
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;
const GL_TEXTURE0: u32 = 0x84C0;
const GL_PACK_ALIGNMENT: u32 = 0x0D05;
const GL_NO_ERROR: u32 = 0;

/// The GLES entry points this needs, by name, from the runtime library.
struct Gles {
    _lib: libloading::Library,
    gen_textures: unsafe extern "C" fn(i32, *mut u32),
    bind_texture: unsafe extern "C" fn(u32, u32),
    tex_parameteri: unsafe extern "C" fn(u32, u32, i32),
    tex_storage_2d: unsafe extern "C" fn(u32, i32, u32, i32, i32),
    gen_framebuffers: unsafe extern "C" fn(i32, *mut u32),
    bind_framebuffer: unsafe extern "C" fn(u32, u32),
    framebuffer_texture_2d: unsafe extern "C" fn(u32, u32, u32, u32, i32),
    check_framebuffer_status: unsafe extern "C" fn(u32) -> u32,
    create_shader: unsafe extern "C" fn(u32) -> u32,
    shader_source: unsafe extern "C" fn(u32, i32, *const *const c_char, *const i32),
    compile_shader: unsafe extern "C" fn(u32),
    get_shaderiv: unsafe extern "C" fn(u32, u32, *mut i32),
    get_shader_info_log: unsafe extern "C" fn(u32, i32, *mut i32, *mut c_char),
    create_program: unsafe extern "C" fn() -> u32,
    attach_shader: unsafe extern "C" fn(u32, u32),
    link_program: unsafe extern "C" fn(u32),
    get_programiv: unsafe extern "C" fn(u32, u32, *mut i32),
    use_program: unsafe extern "C" fn(u32),
    get_uniform_location: unsafe extern "C" fn(u32, *const c_char) -> i32,
    uniform1i: unsafe extern "C" fn(i32, i32),
    uniform2f: unsafe extern "C" fn(i32, f32, f32),
    active_texture: unsafe extern "C" fn(u32),
    viewport: unsafe extern "C" fn(i32, i32, i32, i32),
    clear_color: unsafe extern "C" fn(f32, f32, f32, f32),
    clear: unsafe extern "C" fn(u32),
    draw_arrays: unsafe extern "C" fn(u32, i32, i32),
    pixel_storei: unsafe extern "C" fn(u32, i32),
    read_pixels: unsafe extern "C" fn(i32, i32, i32, i32, u32, u32, *mut c_void),
    get_error: unsafe extern "C" fn() -> u32,
    image_target_texture_2d: unsafe extern "C" fn(u32, *mut c_void),
}

/// The GBM entry points, for allocating a buffer in a format we are given rather than
/// one we happen to have. Loaded by name, like the GLES ones: the alternative is a
/// build dependency on libgbm's headers for six functions.
struct Gbm {
    _lib: libloading::Library,
    _node: std::fs::File,
    device: *mut c_void,
    create: unsafe extern "C" fn(*mut c_void, u32, u32, u32, u32) -> *mut c_void,
    bo_fd: unsafe extern "C" fn(*mut c_void) -> i32,
    bo_stride: unsafe extern "C" fn(*mut c_void) -> u32,
    bo_offset: unsafe extern "C" fn(*mut c_void, i32) -> u32,
    bo_modifier: unsafe extern "C" fn(*mut c_void) -> u64,
    bo_destroy: unsafe extern "C" fn(*mut c_void),
    device_destroy: unsafe extern "C" fn(*mut c_void),
}

/// Rendered into by the compositor and sampled by us, never scanned out. No layout is
/// forced: the driver's own is what it samples best, and the modifier it chooses is
/// passed to EGL and to Wayland so everyone reads the buffer the same way.
const GBM_BO_USE_RENDERING: u32 = 1 << 2;

impl Drop for Gbm {
    fn drop(&mut self) {
        unsafe { (self.device_destroy)(self.device) };
    }
}

/// One entry point by name, or a plain error naming what was absent.
///
/// The pointer outlives the `Symbol` deliberately: the library is kept in the same
/// struct as the pointers, so it is unloaded only when they all go.
macro_rules! sym {
    ($lib:expr, $name:literal, $ty:ty) => {{
        let s: libloading::Symbol<$ty> = unsafe { $lib.get(concat!($name, "\0").as_bytes()) }
            .map_err(|e| io::Error::other(format!("{} missing: {e}", $name)))?;
        *s
    }};
}

/// The vertex stage needs no buffers: four corners from the vertex index, which is
/// what GLES3 is for.
const VERTEX: &str = r#"#version 300 es
out vec2 uv;
uniform vec2 flip;
void main() {
    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
    uv = vec2(p.x, mix(p.y, 1.0 - p.y, flip.y));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"#;

/// The panel's own luma, the same 299/587/114 the kernel's conversion uses, so a
/// frame the GPU greys and a frame `drm_fb_xrgb8888_to_gray8` greys agree.
const FRAGMENT: &str = r#"#version 300 es
#extension GL_OES_EGL_image_external_essl3 : require
precision mediump float;
// External, because that is the only target a dmabuf import can be bound to. A
// `sampler2D` here compiles and links perfectly well and reads black from a unit that
// holds an external texture, which is a whole evening of looking in the wrong place.
uniform samplerExternalOES frame;
in vec2 uv;
out vec4 luma;
void main() {
    vec3 c = texture(frame, uv).rgb;
    luma = vec4(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 0.0, 1.0);
}
"#;

/// Turns captured dmabufs into panel-sized greyscale frames.
pub struct Converter {
    egl: egl::DynamicInstance<egl::EGL1_5>,
    display: egl::Display,
    gles: Gles,
    program: u32,
    frame_uniform: i32,
    flip_uniform: i32,
    gbm: Gbm,
    /// The texture a copy is sampled through, one at a time.
    capture: u32,
    /// Kept because they must outlive every GL object here, not because they are read
    /// again: the context every call runs in, and the texture the framebuffer draws to.
    #[allow(dead_code)]
    context: egl::Context,
    #[allow(dead_code)]
    target: u32,
    /// Two buffers, so the compositor can be copying into one while the other is being
    /// converted and committed. With a single buffer the request could only be made
    /// after the commit, which missed the compositor's cadence every time: the copy
    /// phase measured 15 to 33 ms of pure waiting and a game ran at 35 fps instead of
    /// 60.
    buffers: [Option<Buffer>; 2],
    fbo: u32,
    dw: u32,
    dh: u32,
}

impl Converter {
    /// Set up a context with no surface and a `dw` by `dh` single-channel target.
    pub fn new(dw: u32, dh: u32) -> io::Result<Self> {
        let egl = unsafe { egl::DynamicInstance::<egl::EGL1_5>::load_required() }
            .map_err(|e| io::Error::other(format!("no libEGL: {e:?}")))?;

        const PLATFORM_SURFACELESS_MESA: egl::Enum = 0x31DD;
        let display = unsafe {
            egl.get_platform_display(
                PLATFORM_SURFACELESS_MESA,
                egl::DEFAULT_DISPLAY,
                &[egl::ATTRIB_NONE],
            )
        }
        .map_err(|e| io::Error::other(format!("surfaceless display: {e}")))?;
        egl.initialize(display).map_err(io::Error::other)?;

        let extensions = egl
            .query_string(Some(display), egl::EXTENSIONS)
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        for needed in ["EGL_EXT_image_dma_buf_import", "EGL_KHR_surfaceless_context"] {
            if !extensions.contains(needed) {
                return Err(io::Error::other(format!("EGL has no {needed}")));
            }
        }

        egl.bind_api(egl::OPENGL_ES_API).map_err(io::Error::other)?;
        let config = egl
            .choose_first_config(
                display,
                &[
                    egl::SURFACE_TYPE,
                    egl::PBUFFER_BIT,
                    egl::RENDERABLE_TYPE,
                    egl::OPENGL_ES2_BIT,
                    egl::NONE,
                ],
            )
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("no EGL config"))?;
        let context = egl
            .create_context(
                display,
                config,
                None,
                &[
                    egl::CONTEXT_MAJOR_VERSION,
                    3,
                    egl::CONTEXT_MINOR_VERSION,
                    0,
                    egl::NONE,
                ],
            )
            .map_err(io::Error::other)?;
        // Current on this thread for as long as the converter lives, which is why the
        // converter is built on the thread that will use it.
        egl.make_current(display, None, None, Some(context))
            .map_err(io::Error::other)?;

        let lib = unsafe { libloading::Library::new("libGLESv2.so.2") }
            .map_err(|e| io::Error::other(format!("no libGLESv2: {e}")))?;
        let image_target = egl
            .get_proc_address("glEGLImageTargetTexture2DOES")
            .ok_or_else(|| io::Error::other("no glEGLImageTargetTexture2DOES"))?;
        let gles = Gles {
            gen_textures: sym!(lib, "glGenTextures", unsafe extern "C" fn(i32, *mut u32)),
            bind_texture: sym!(lib, "glBindTexture", unsafe extern "C" fn(u32, u32)),
            tex_parameteri: sym!(lib, "glTexParameteri", unsafe extern "C" fn(u32, u32, i32)),
            tex_storage_2d: sym!(lib, "glTexStorage2D", unsafe extern "C" fn(u32, i32, u32, i32, i32)),
            gen_framebuffers: sym!(lib, "glGenFramebuffers", unsafe extern "C" fn(i32, *mut u32)),
            bind_framebuffer: sym!(lib, "glBindFramebuffer", unsafe extern "C" fn(u32, u32)),
            framebuffer_texture_2d: sym!(lib, "glFramebufferTexture2D", unsafe extern "C" fn(u32, u32, u32, u32, i32)),
            check_framebuffer_status: sym!(lib, "glCheckFramebufferStatus", unsafe extern "C" fn(u32) -> u32),
            create_shader: sym!(lib, "glCreateShader", unsafe extern "C" fn(u32) -> u32),
            shader_source: sym!(lib, "glShaderSource", unsafe extern "C" fn(u32, i32, *const *const c_char, *const i32)),
            compile_shader: sym!(lib, "glCompileShader", unsafe extern "C" fn(u32)),
            get_shaderiv: sym!(lib, "glGetShaderiv", unsafe extern "C" fn(u32, u32, *mut i32)),
            get_shader_info_log: sym!(lib, "glGetShaderInfoLog", unsafe extern "C" fn(u32, i32, *mut i32, *mut c_char)),
            create_program: sym!(lib, "glCreateProgram", unsafe extern "C" fn() -> u32),
            attach_shader: sym!(lib, "glAttachShader", unsafe extern "C" fn(u32, u32)),
            link_program: sym!(lib, "glLinkProgram", unsafe extern "C" fn(u32)),
            get_programiv: sym!(lib, "glGetProgramiv", unsafe extern "C" fn(u32, u32, *mut i32)),
            use_program: sym!(lib, "glUseProgram", unsafe extern "C" fn(u32)),
            get_uniform_location: sym!(lib, "glGetUniformLocation", unsafe extern "C" fn(u32, *const c_char) -> i32),
            uniform1i: sym!(lib, "glUniform1i", unsafe extern "C" fn(i32, i32)),
            uniform2f: sym!(lib, "glUniform2f", unsafe extern "C" fn(i32, f32, f32)),
            active_texture: sym!(lib, "glActiveTexture", unsafe extern "C" fn(u32)),
            viewport: sym!(lib, "glViewport", unsafe extern "C" fn(i32, i32, i32, i32)),
            clear_color: sym!(lib, "glClearColor", unsafe extern "C" fn(f32, f32, f32, f32)),
            clear: sym!(lib, "glClear", unsafe extern "C" fn(u32)),
            draw_arrays: sym!(lib, "glDrawArrays", unsafe extern "C" fn(u32, i32, i32)),
            pixel_storei: sym!(lib, "glPixelStorei", unsafe extern "C" fn(u32, i32)),
            read_pixels: sym!(lib, "glReadPixels", unsafe extern "C" fn(i32, i32, i32, i32, u32, u32, *mut c_void)),
            get_error: sym!(lib, "glGetError", unsafe extern "C" fn() -> u32),
            image_target_texture_2d: unsafe { std::mem::transmute(image_target) },
            _lib: lib,
        };

        let gbm = load_gbm()?;
        let program = build_program(&gles)?;
        let (frame_uniform, flip_uniform) = unsafe {
            (
                (gles.get_uniform_location)(program, c"frame".as_ptr()),
                (gles.get_uniform_location)(program, c"flip".as_ptr()),
            )
        };

        let (mut capture, mut target, mut fbo) = (0u32, 0u32, 0u32);
        unsafe {
            (gles.gen_textures)(1, &mut capture);
            (gles.gen_textures)(1, &mut target);
            (gles.bind_texture)(GL_TEXTURE_2D, target);
            (gles.tex_storage_2d)(GL_TEXTURE_2D, 1, GL_R8, dw as i32, dh as i32);
            (gles.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            (gles.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
            (gles.gen_framebuffers)(1, &mut fbo);
            (gles.bind_framebuffer)(GL_FRAMEBUFFER, fbo);
            (gles.framebuffer_texture_2d)(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                target,
                0,
            );
            if (gles.check_framebuffer_status)(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE {
                return Err(io::Error::other("no R8 render target"));
            }
            (gles.pixel_storei)(GL_PACK_ALIGNMENT, 1);
        }

        Ok(Self {
            egl,
            display,
            gles,
            program,
            frame_uniform,
            flip_uniform,
            gbm,
            capture,
            context,
            target,
            buffers: [None, None],
            fbo,
            dw,
            dh,
        })
    }

    /// Allocate a `w` by `h` buffer in `fourcc` for the compositor to copy into.
    ///
    /// Imported once here rather than per frame: the buffer outlives any one frame, and
    /// the compositor copies into it again and again.
    pub fn allocate(&mut self, slot: usize, fourcc: u32, w: u32, h: u32) -> io::Result<Target> {
        self.release(slot);

        let g = &self.gbm;
        let bo = unsafe { (g.create)(g.device, w, h, fourcc, GBM_BO_USE_RENDERING) };
        if bo.is_null() {
            return Err(io::Error::other(format!(
                "GBM would not allocate {w}x{h} in {}",
                fourcc_name(fourcc)
            )));
        }
        let (fd, stride, offset, modifier) = unsafe {
            (
                (g.bo_fd)(bo),
                (g.bo_stride)(bo),
                (g.bo_offset)(bo, 0),
                (g.bo_modifier)(bo),
            )
        };
        if fd < 0 {
            unsafe { (g.bo_destroy)(bo) };
            return Err(io::Error::other("the buffer has no descriptor"));
        }
        let fd = unsafe { OwnedFd::from_raw_fd(fd) };

        let image = self.import(&fd, fourcc, modifier, offset, stride, w, h)?;
        self.buffers[slot.min(1)] = Some(Buffer { bo, image, size: (w, h) });

        Ok(Target {
            planes: vec![Plane { fd, offset, stride }],
            fourcc,
            modifier,
            w,
            h,
        })
    }

    /// Let go of one buffer and its image, if there is one.
    fn release(&mut self, slot: usize) {
        if let Some(buffer) = self.buffers[slot.min(1)].take() {
            let _ = self.egl.destroy_image(self.display, buffer.image);
            unsafe { (self.gbm.bo_destroy)(buffer.bo) };
        }
    }

    /// The size a slot was allocated for, if it holds a buffer.
    pub fn size_of(&self, slot: usize) -> Option<(u32, u32)> {
        self.buffers[slot.min(1)].as_ref().map(|b| b.size)
    }

    /// Scale and grey whatever the compositor last copied in, and write the panel's
    /// bytes.
    ///
    /// The image is created and destroyed per frame, which is what the export protocol
    /// hands us: a buffer, not a promise about a buffer. Nothing is copied on the way
    /// in, and the only bytes that cross to the CPU are the 36KB written into `out`.
    pub fn convert_into(&mut self, slot: usize, y_invert: bool, out: &mut [u8]) -> io::Result<()> {
        if out.len() < (self.dw * self.dh) as usize {
            return Err(io::Error::other("the frame does not fit the panel"));
        }
        let buffer = self.buffers[slot.min(1)]
            .as_ref()
            .ok_or_else(|| io::Error::other("no buffer imported"))?;
        let (sw, sh) = buffer.size;
        let image = buffer.image.as_ptr();
        let g = &self.gles;

        // The largest whole-pixel box that keeps the frame's shape, centred: the
        // sampler does the scaling, so the fit is only a viewport.
        let (dw, dh) = (self.dw, self.dh);
        let (sw, sh) = (sw.max(1), sh.max(1));
        let (w, h) = if sw * dh > dw * sh {
            (dw, (sh * dw / sw).max(1))
        } else {
            ((sw * dh / sh).max(1), dh)
        };
        let (ox, oy) = ((dw - w) / 2, (dh - h) / 2);

        let outcome = unsafe {
            (g.bind_framebuffer)(GL_FRAMEBUFFER, self.fbo);
            (g.use_program)(self.program);
            (g.active_texture)(GL_TEXTURE0);
            (g.bind_texture)(GL_TEXTURE_EXTERNAL_OES, self.capture);
            (g.image_target_texture_2d)(GL_TEXTURE_EXTERNAL_OES, image);
            (g.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            (g.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            (g.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            (g.tex_parameteri)(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            (g.uniform1i)(self.frame_uniform, 0);
            (g.uniform2f)(self.flip_uniform, 0.0, if y_invert { 1.0 } else { 0.0 });

            // Letterbox bars belong to the panel, not to the last frame's edges.
            (g.viewport)(0, 0, dw as i32, dh as i32);
            (g.clear_color)(0.0, 0.0, 0.0, 1.0);
            (g.clear)(GL_COLOR_BUFFER_BIT);

            (g.viewport)(ox as i32, oy as i32, w as i32, h as i32);
            (g.draw_arrays)(GL_TRIANGLE_STRIP, 0, 4);

            // Blocks until the draw is done, which is the synchronisation this needs.
            (g.read_pixels)(
                0,
                0,
                dw as i32,
                dh as i32,
                GL_RED,
                GL_UNSIGNED_BYTE,
                out.as_mut_ptr().cast(),
            );
            let err = (g.get_error)();
            if err == GL_NO_ERROR {
                Ok(())
            } else {
                Err(io::Error::other(format!("GL error 0x{err:x}")))
            }
        };
        outcome
    }

    /// Wrap a dmabuf as an EGL image so it can be sampled. Nothing is copied.
    #[allow(clippy::too_many_arguments)]
    fn import(
        &self,
        fd: &OwnedFd,
        fourcc: u32,
        modifier: u64,
        offset: u32,
        stride: u32,
        w: u32,
        h: u32,
    ) -> io::Result<egl::Image> {
        // The attribute names are per-plane and consecutive, so the three planes a
        // format may carry are one pattern rather than three cases.
        const FD: [egl::Attrib; 3] = [0x3272, 0x3275, 0x3278];
        const OFFSET: [egl::Attrib; 3] = [0x3273, 0x3276, 0x3279];
        const STRIDE: [egl::Attrib; 3] = [0x3274, 0x3277, 0x327A];
        const MOD_LO: [egl::Attrib; 3] = [0x3443, 0x3445, 0x3447];
        const MOD_HI: [egl::Attrib; 3] = [0x3444, 0x3446, 0x3448];
        const LINUX_DMA_BUF_EXT: egl::Enum = 0x3270;
        const WIDTH: egl::Attrib = 0x3057;
        const HEIGHT: egl::Attrib = 0x3056;
        const FOURCC: egl::Attrib = 0x3271;

        use std::os::fd::AsRawFd;
        let attribs: Vec<egl::Attrib> = vec![
            WIDTH,
            w as egl::Attrib,
            HEIGHT,
            h as egl::Attrib,
            FOURCC,
            fourcc as egl::Attrib,
            FD[0],
            fd.as_raw_fd() as egl::Attrib,
            OFFSET[0],
            offset as egl::Attrib,
            STRIDE[0],
            stride as egl::Attrib,
            // Stated even when zero, which is `DRM_FORMAT_MOD_LINEAR`: an import with
            // no modifier attributes takes the driver's implicit layout instead.
            MOD_LO[0],
            (modifier & 0xffff_ffff) as egl::Attrib,
            MOD_HI[0],
            (modifier >> 32) as egl::Attrib,
            egl::ATTRIB_NONE,
        ];

        unsafe {
            self.egl
                .create_image(
                    self.display,
                    egl::Context::from_ptr(egl::NO_CONTEXT),
                    LINUX_DMA_BUF_EXT,
                    egl::ClientBuffer::from_ptr(std::ptr::null_mut()),
                    &attribs,
                )
                .map_err(|e| io::Error::other(format!("dmabuf import: {e}")))
        }
    }
}

/// Open the render node and load the handful of GBM functions this needs.
fn load_gbm() -> io::Result<Gbm> {
    // By path rather than by number: card and render node numbers move between
    // kernels, which has already cost this project a blank panel once. On any other
    // machine that path does not exist, so `--render-node` names the node to use and
    // renderD128 is the last resort.
    let open = |path: &str| {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
    };
    let node = match std::env::var("FLIPCTL_RENDER_NODE") {
        Ok(named) => open(&named)?,
        Err(_) => open("/dev/dri/by-path/platform-27800000.gpu-render")
            .or_else(|_| open("/dev/dri/renderD128"))?,
    };
    let lib = unsafe { libloading::Library::new("libgbm.so.1") }
        .map_err(|e| io::Error::other(format!("no libgbm: {e}")))?;
    let create_device: unsafe extern "C" fn(i32) -> *mut c_void =
        sym!(lib, "gbm_create_device", unsafe extern "C" fn(i32) -> *mut c_void);
    Ok(Gbm {
        create: sym!(
            lib,
            "gbm_bo_create",
            unsafe extern "C" fn(*mut c_void, u32, u32, u32, u32) -> *mut c_void
        ),
        bo_fd: sym!(lib, "gbm_bo_get_fd", unsafe extern "C" fn(*mut c_void) -> i32),
        bo_stride: sym!(lib, "gbm_bo_get_stride", unsafe extern "C" fn(*mut c_void) -> u32),
        bo_offset: sym!(
            lib,
            "gbm_bo_get_offset",
            unsafe extern "C" fn(*mut c_void, i32) -> u32
        ),
        bo_modifier: sym!(
            lib,
            "gbm_bo_get_modifier",
            unsafe extern "C" fn(*mut c_void) -> u64
        ),
        bo_destroy: sym!(lib, "gbm_bo_destroy", unsafe extern "C" fn(*mut c_void)),
        device_destroy: sym!(lib, "gbm_device_destroy", unsafe extern "C" fn(*mut c_void)),
        device: {
            use std::os::fd::AsRawFd;
            let device = unsafe { create_device(node.as_raw_fd()) };
            if device.is_null() {
                return Err(io::Error::other("GBM would not open the render node"));
            }
            device
        },
        _node: node,
        _lib: lib,
    })
}

/// A DRM fourcc as the four characters it is, for a message a person can read.
pub fn fourcc_name(code: u32) -> String {
    let bytes = code
        .to_le_bytes()
        .map(|b| if b.is_ascii_graphic() { b } else { b'?' });
    String::from_utf8_lossy(&bytes).into_owned()
}

fn build_program(g: &Gles) -> io::Result<u32> {
    let vertex = compile(g, GL_VERTEX_SHADER, VERTEX)?;
    let fragment = compile(g, GL_FRAGMENT_SHADER, FRAGMENT)?;
    unsafe {
        let program = (g.create_program)();
        (g.attach_shader)(program, vertex);
        (g.attach_shader)(program, fragment);
        (g.link_program)(program);
        let mut ok = 0;
        (g.get_programiv)(program, GL_LINK_STATUS, &mut ok);
        if ok == 0 {
            return Err(io::Error::other("shader program would not link"));
        }
        Ok(program)
    }
}

fn compile(g: &Gles, kind: u32, source: &str) -> io::Result<u32> {
    unsafe {
        let shader = (g.create_shader)(kind);
        let ptr = source.as_ptr().cast::<c_char>();
        let len = source.len() as i32;
        (g.shader_source)(shader, 1, &ptr, &len);
        (g.compile_shader)(shader);
        let mut ok = 0;
        (g.get_shaderiv)(shader, GL_COMPILE_STATUS, &mut ok);
        if ok == 0 {
            let mut log = vec![0 as c_char; 1024];
            let mut written = 0;
            (g.get_shader_info_log)(shader, log.len() as i32, &mut written, log.as_mut_ptr());
            let text = CStr::from_ptr(log.as_ptr()).to_string_lossy().into_owned();
            return Err(io::Error::other(format!("shader: {text}")));
        }
        Ok(shader)
    }
}
