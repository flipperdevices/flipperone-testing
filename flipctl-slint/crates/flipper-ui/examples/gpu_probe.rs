//! What the GPU offers for turning a captured dmabuf into a panel frame.
//!
//! Asked before writing the shader path, because all of it depends on three
//! extensions being present: importing a dmabuf as an EGL image, a context with no
//! surface to render from, and single-channel render targets to read back 36KB
//! instead of 147KB.

fn main() {
    let egl = unsafe { khronos_egl::DynamicInstance::<khronos_egl::EGL1_5>::load_required() };
    let egl = match egl {
        Ok(e) => e,
        Err(e) => {
            eprintln!("no libEGL: {e:?}");
            return;
        }
    };

    // Client extensions come from the "no display" query, which is how a platform is
    // chosen before there is anything to choose it for.
    let client = egl
        .query_string(None, khronos_egl::EXTENSIONS)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    for want in [
        "EGL_EXT_platform_base",
        "EGL_MESA_platform_surfaceless",
        "EGL_EXT_platform_device",
        "EGL_KHR_platform_gbm",
    ] {
        println!("client {want}: {}", client.contains(want));
    }

    // Surfaceless: no window, no pbuffer, just a context to render into an FBO.
    const PLATFORM_SURFACELESS_MESA: khronos_egl::Enum = 0x31DD;
    let display = unsafe {
        egl.get_platform_display(
            PLATFORM_SURFACELESS_MESA,
            khronos_egl::DEFAULT_DISPLAY,
            &[khronos_egl::ATTRIB_NONE],
        )
    };
    let display = match display {
        Ok(d) => d,
        Err(e) => {
            println!("surfaceless display: refused ({e})");
            return;
        }
    };
    match egl.initialize(display) {
        Ok((major, minor)) => println!("EGL {major}.{minor} on a surfaceless display"),
        Err(e) => {
            println!("initialize: {e}");
            return;
        }
    }

    let ext = egl
        .query_string(Some(display), khronos_egl::EXTENSIONS)
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    for want in [
        "EGL_EXT_image_dma_buf_import",
        "EGL_EXT_image_dma_buf_import_modifiers",
        "EGL_KHR_surfaceless_context",
        "EGL_KHR_image_base",
        "EGL_KHR_gl_texture_2D_image",
        "EGL_KHR_fence_sync",
        // Deciding how a capture buffer gets allocated: exporting one from EGL needs
        // no new dependency, GBM would.
        "EGL_MESA_image_dma_buf_export",
        "EGL_KHR_gl_renderbuffer_image",
    ] {
        println!("display {want}: {}", ext.contains(want));
    }

    // A context, then what GLES says about itself: the renderer confirms which GPU
    // does the work, and the version decides whether R8 render targets exist.
    egl.bind_api(khronos_egl::OPENGL_ES_API).ok();
    let config = egl
        .choose_first_config(
            display,
            &[
                khronos_egl::SURFACE_TYPE,
                khronos_egl::PBUFFER_BIT,
                khronos_egl::RENDERABLE_TYPE,
                khronos_egl::OPENGL_ES2_BIT,
                khronos_egl::NONE,
            ],
        )
        .ok()
        .flatten();
    let Some(config) = config else {
        println!("no config with a pbuffer bit; surfaceless contexts may still work");
        return;
    };
    let context = egl.create_context(
        display,
        config,
        None,
        &[
            khronos_egl::CONTEXT_MAJOR_VERSION,
            3,
            khronos_egl::CONTEXT_MINOR_VERSION,
            0,
            khronos_egl::NONE,
        ],
    );
    let context = match context {
        Ok(c) => c,
        Err(e) => {
            println!("GLES3 context: refused ({e})");
            return;
        }
    };
    if let Err(e) = egl.make_current(display, None, None, Some(context)) {
        println!("make_current with no surface: {e}");
        return;
    }

    // The whole path, with nothing but us in it: allocate, write a known grey with the
    // CPU, sample it through the shader, read the result back.
    match flipper_ui::gpu::Converter::new(
        u32::from(flipper_ui::PANEL_W),
        u32::from(flipper_ui::PANEL_H),
    ) {
        Ok(mut converter) => {
            match converter.self_test_draw(0x40) {
                Ok(mean) => println!(
                    "self test: a constant draw of 0x40 read back as mean {mean} \
                     (expected about 64)"
                ),
                Err(e) => println!("self test: constant draw: {e}"),
            }
            // Every plausible format, and a few fills each: if one of them reads back
            // what was written, the import works and the format is the question.
            for name in [b"XR24", b"AR24", b"AB24", b"XB24"] {
                let fourcc = u32::from_le_bytes(*name);
                let label = String::from_utf8_lossy(name).into_owned();
                let mut line = format!("self test {label}:");
                for value in [0x20u8, 0x80, 0xff] {
                    match converter.self_test(fourcc, value) {
                        Ok(mean) => line.push_str(&format!(" {value:#04x}->{mean}")),
                        Err(e) => {
                            line.push_str(&format!(" {value:#04x}->refused ({e})"));
                            break;
                        }
                    }
                }
                println!("{line}");
            }
        }
        Err(e) => println!("no converter: {e}"),
    }

    let gles = unsafe { libloading::Library::new("libGLESv2.so.2") };
    let Ok(gles) = gles else {
        println!("no libGLESv2");
        return;
    };
    type GetString = unsafe extern "C" fn(u32) -> *const std::ffi::c_char;
    let get_string: libloading::Symbol<GetString> = unsafe { gles.get(b"glGetString\0").unwrap() };
    let read = |name: u32| unsafe {
        let p = get_string(name);
        if p.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    };
    println!("GL_VERSION  {}", read(0x1F02));
    println!("GL_RENDERER {}", read(0x1F01));
    let gl_ext = read(0x1F03);
    for want in [
        "GL_OES_EGL_image_external",
        "GL_OES_EGL_image_external_essl3",
        "GL_EXT_texture_rg",
        "GL_OES_rgb8_rgba8",
    ] {
        println!("gl {want}: {}", gl_ext.contains(want));
    }
}
