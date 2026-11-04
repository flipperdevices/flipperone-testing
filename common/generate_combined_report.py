#!/usr/bin/env python3

import sys
import os
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime
import json
import html

def read_system_info(info_file):
    """Read and parse system information file."""
    system_info = {
        'board_model': 'Unknown',
        'hostname': 'Unknown', 
        'kernel_version': 'Unknown',
        'linux_distro': 'Unknown',
        'thermal_governor': [],
        'test_name': ''
    }
    
    if not os.path.exists(info_file):
        return system_info
    
    with open(info_file, 'r') as f:
        lines = f.readlines()
    
    current_section = None
    for line in lines:
        line = line.strip()
        
        if 'Board Model:' in line:
            system_info['board_model'] = line.split('Board Model:', 1)[1].strip()
        elif 'Hostname:' in line:
            system_info['hostname'] = line.split('Hostname:', 1)[1].strip()
        elif 'Full Kernel Info:' in line:
            system_info['kernel_version'] = line.split('Full Kernel Info:', 1)[1].strip()
        elif 'Test Name:' in line:
            system_info['test_name'] = line.split('Test Name:', 1)[1].strip()
        elif line.startswith('thermal_zone') and ':' in line:
            system_info['thermal_governor'].append(line)
        elif '=== Linux Distribution ===' in line:
            current_section = 'distro'
        elif current_section == 'distro' and line and not line.startswith('==='):
            if 'Description:' in line:
                system_info['linux_distro'] = line.split('Description:', 1)[1].strip()
            elif 'PRETTY_NAME=' in line:
                system_info['linux_distro'] = line.split('PRETTY_NAME=', 1)[1].strip('"')
    
    return system_info

def generate_gpu_graph(csv_file):
    """Generate GPU performance graph from GPU data."""
    try:
        df = pd.read_csv(csv_file)
        if df.empty or 'gpu_load' not in df.columns:
            return None, 0
        
        gpu_hover = []
        for _, row in df.iterrows():
            text = f"<b>GPU Load: {row['gpu_load']:.0f}%</b><br>"
            text += f"Time: {row['seconds']:.1f}s<br>"
            if 'gpu_freq' in df.columns and pd.notna(row['gpu_freq']):
                text += f"GPU Frequency: {row['gpu_freq']:.0f} MHz<br>"
            gpu_hover.append(text)
        
        trace = go.Scatter(
            x=df['seconds'],
            y=df['gpu_load'],
            mode='lines',
            name='GPU Load (%)',
            line=dict(color='#FF9800', width=2),
            hovertemplate='%{text}<extra></extra>',
            text=gpu_hover
        )
        
        duration = df['seconds'].iloc[-1] / 60 if len(df) > 0 else 1
        return trace, duration
        
    except Exception as e:
        print(f"Error processing GPU data: {e}")
        return None, 0

def generate_network_graph(csv_file):
    """Generate Network Latency graph from test metrics."""
    try:
        df = pd.read_csv(csv_file)
        if df.empty or 'Latency_ms' not in df.columns:
            return None
        
        network_hover = []
        for _, row in df.iterrows():
            text = f"<b>Status: {row['Interface_Status']}</b><br>"
            text += f"Time: {row['seconds']}s<br>"
            text += f"Latency: {row['Latency_ms']:.2f} ms<br>"
            network_hover.append(text)
            
        trace = go.Scatter(
            x=df['seconds'],
            y=df['Latency_ms'],
            mode='lines+markers',
            name='Network Latency (ms)',
            line=dict(color='#00A8FF', width=2),
            hovertemplate='%{text}<extra></extra>',
            text=network_hover
        )
        return trace
    except Exception as e:
        print(f"Error processing network data: {e}")
        return None

def generate_temperature_graph(csv_file):
    """Generate temperature graph for backward compatibility."""
    if not os.path.exists(csv_file):
        return None, None
    
    try:
        df = pd.read_csv(csv_file, comment='#')
        if df.empty:
            return None, None
        
        if 'seconds' in df.columns:
            df['time'] = df['seconds']
            time_column = 'time'
        else:
            return None, None
        
        temp_columns = [col for col in df.columns if col not in ['seconds', 'time']]
        if not temp_columns:
            return None, None
        
        for col in temp_columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        df['avg_temp'] = df[temp_columns].mean(axis=1)
        
        trace = go.Scatter(
            x=df[time_column],
            y=df['avg_temp'],
            mode='lines',
            name='Temperature (°C)',
            line=dict(color='#FF6B6B', width=2)
        )
        
        duration = df[time_column].iloc[-1] / 60
        return trace, max(0.1, duration)
        
    except Exception as e:
        return None, None

def generate_system_graphs(csv_file):
    """Generate system monitoring graphs with temperature, CPU load, and CPU frequency."""
    if not os.path.exists(csv_file):
        return [], None
    
    try:
        df = pd.read_csv(csv_file, comment='#')
        if df.empty or 'seconds' not in df.columns:
            return [], None
        
        time_column = 'seconds'
        traces = []
        
        # 1. Temperature trace
        temp_columns = [col for col in df.columns if col.startswith('temp_')]
        if temp_columns:
            for col in temp_columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            df['avg_temp'] = df[temp_columns].mean(axis=1)
            
            temp_hover = []
            for idx, row in df.iterrows():
                text = f"<b>Avg Temperature: {row['avg_temp']:.1f}°C</b><br>"
                text += f"Time: {row[time_column]:.1f}s<br><br><b>Sensors:</b><br>"
                for col in temp_columns:
                    sensor_name = col.replace('temp_', '').replace('_', ' ').title()
                    if pd.notna(row[col]):
                        text += f"{sensor_name}: {row[col]:.1f}°C<br>"
                temp_hover.append(text)
            
            traces.append(go.Scatter(
                x=df[time_column], y=df['avg_temp'], mode='lines',
                name='Temperature (°C)', line=dict(color='#FF6B6B', width=2),
                hovertemplate='%{text}<extra></extra>', text=temp_hover, yaxis='y'
            ))
        
        # 2. CPU Load trace
        load_columns = [col for col in df.columns if col.startswith('load_')]
        if load_columns:
            for col in load_columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            df['avg_load'] = df[load_columns].mean(axis=1)
            
            load_hover = []
            for idx, row in df.iterrows():
                text = f"<b>Avg CPU Load: {row['avg_load']:.1f}%</b><br>"
                text += f"Time: {row[time_column]:.1f}s<br><br><b>Per Core:</b><br>"
                for col in sorted(load_columns):
                    core_num = col.replace('load_cpu', '')
                    if pd.notna(row[col]):
                        text += f"Core {core_num}: {row[col]:.0f}%<br>"
                load_hover.append(text)
            
            traces.append(go.Scatter(
                x=df[time_column], y=df['avg_load'], mode='lines',
                name='CPU Load (%)', line=dict(color='#4ECDC4', width=2),
                hovertemplate='%{text}<extra></extra>', text=load_hover, yaxis='y2'
            ))
        
        # 3. CPU Frequency trace
        freq_columns = [col for col in df.columns if col.startswith('freq_')]
        if freq_columns:
            for col in freq_columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            df['avg_freq'] = df[freq_columns].mean(axis=1)
            
            freq_hover = []
            for idx, row in df.iterrows():
                text = f"<b>Avg CPU Freq: {row['avg_freq']:.0f} MHz</b><br>"
                text += f"Time: {row[time_column]:.1f}s<br><br><b>Per Core:</b><br>"
                for col in sorted(freq_columns):
                    core_num = col.replace('freq_cpu', '')
                    if pd.notna(row[col]):
                        core_type = "LITTLE" if int(core_num) < 4 else "BIG"
                        text += f"Core {core_num} ({core_type}): {row[col]:.0f} MHz<br>"
                freq_hover.append(text)
            
            traces.append(go.Scatter(
                x=df[time_column], y=df['avg_freq'], mode='lines',
                name='CPU Frequency (MHz)', line=dict(color='#95E77E', width=2),
                hovertemplate='%{text}<extra></extra>', text=freq_hover, yaxis='y3'
            ))
        
        duration = df[time_column].iloc[-1] / 60
        return traces, max(0.1, duration)
        
    except Exception as e:
        print(f"Error processing system data: {e}")
        return [], None

def generate_combined_report(results_dir):
    """Generate a combined HTML report for all tests."""
    system_info = read_system_info(os.path.join(results_dir, 'system_info.txt'))
    
    # Check for CPU stress markers and log
    cpu_stress_status = None
    cpu_stress_log_content = ""
    cpu_stress_marker_file = os.path.join(results_dir, 'cpu_stress_marker.txt')
    if os.path.exists(cpu_stress_marker_file):
        with open(cpu_stress_marker_file, 'r') as f:
            marker_content = f.read()
            if 'CPU_STRESS=RUNNING' in marker_content or 'PID=' in marker_content:
                cpu_stress_status = 'success'
            elif 'STATUS=FAILED' in marker_content:
                cpu_stress_status = 'failed'
                
    cpu_stress_log_file = os.path.join(results_dir, 'cpu_stress.log')
    if os.path.exists(cpu_stress_log_file):
        with open(cpu_stress_log_file, 'r') as f:
            cpu_stress_log_content = html.escape(f.read())
    
    # Check for GPU stress markers and log
    gpu_stress_status = None
    gpu_stress_log_content = ""
    gpu_info_content = ""
    gpu_stress_marker_file = os.path.join(results_dir, 'gpu_stress_marker.txt')
    if os.path.exists(gpu_stress_marker_file):
        with open(gpu_stress_marker_file, 'r') as f:
            marker_content = f.read()
            if 'GPU_STRESS=RUNNING' in marker_content or 'PID=' in marker_content:
                gpu_stress_status = 'success'
            elif 'STATUS=FAILED' in marker_content:
                gpu_stress_status = 'failed'
                
    gpu_stress_log_file = os.path.join(results_dir, 'gpu_stress.log')
    if os.path.exists(gpu_stress_log_file):
        with open(gpu_stress_log_file, 'r') as f:
            full_log = f.read()
            gpu_stress_log_content = html.escape(full_log)
            if 'OpenGL Information' in full_log:
                lines = full_log.split('\n')
                in_header = False
                gpu_info_lines = []
                for line in lines:
                    if 'OpenGL Information' in line:
                        in_header = True
                        continue
                    elif in_header and line.strip().startswith('Surface Size:'):
                        gpu_info_lines.append(line.strip())
                        break
                    elif in_header and (line.strip().startswith('GL_') or line.strip().startswith('Surface')):
                        gpu_info_lines.append(line.strip())
                gpu_info_content = html.escape('\n'.join(gpu_info_lines))
    
    system_info_text = ""
    system_info_file = os.path.join(results_dir, 'system_info.txt')
    if os.path.exists(system_info_file):
        with open(system_info_file, 'r') as f:
            system_info_text = html.escape(f.read())
            
    traces = []
    test_duration = None
    
    if os.path.exists(os.path.join(results_dir, 'system_data.csv')):
        traces, test_duration = generate_system_graphs(os.path.join(results_dir, 'system_data.csv'))
    elif os.path.exists(os.path.join(results_dir, 'temperature_data.csv')):
        temp_trace, test_duration = generate_temperature_graph(os.path.join(results_dir, 'temperature_data.csv'))
        if temp_trace: traces = [temp_trace]
        
    gpu_graph_html = ""
    if os.path.exists(os.path.join(results_dir, 'gpu_data.csv')):
        gpu_trace, gpu_duration = generate_gpu_graph(os.path.join(results_dir, 'gpu_data.csv'))
        if gpu_trace:
            gpu_fig = go.Figure(data=[gpu_trace])
            gpu_fig.update_layout(
                title={'text': 'GPU Performance', 'x': 0.5, 'xanchor': 'center', 'font': {'size': 18}},
                xaxis=dict(title="Time (seconds)"),
                yaxis=dict(title="GPU Load (%)", range=[0, 100], titlefont=dict(color="#FF9800"), tickfont=dict(color="#FF9800")),
                height=400, margin=dict(l=60, r=60, t=60, b=60), plot_bgcolor='#f8f9fa', paper_bgcolor='white', hovermode='x'
            )
            gpu_graph_html = gpu_fig.to_html(include_plotlyjs=False).replace('<div>', '<div id="gpuChart">', 1)
            
    # Dynamic Network Graph Generation
    network_graph_html = ""
    network_csv = os.path.join(results_dir, 'network_data.csv')
    if os.path.exists(network_csv):
        net_trace = generate_network_graph(network_csv)
        if net_trace:
            net_fig = go.Figure(data=[net_trace])
            net_fig.update_layout(
                title={'text': 'Network Stability & Latency', 'x': 0.5, 'xanchor': 'center', 'font': {'size': 18}},
                xaxis=dict(title="Time (seconds)"),
                yaxis=dict(title="Round Trip Time (ms)", titlefont=dict(color="#00A8FF"), tickfont=dict(color="#00A8FF")),
                height=400, margin=dict(l=60, r=60, t=60, b=60), plot_bgcolor='#f8f9fa', paper_bgcolor='white', hovermode='x'
            )
            network_graph_html = net_fig.to_html(include_plotlyjs=False).replace('<div>', '<div id="networkChart">', 1)

    fig = go.Figure()
    for trace in traces: fig.add_trace(trace)
    
    fig.update_layout(
        title={'text': 'System Monitoring', 'x': 0.5, 'xanchor': 'center', 'font': {'size': 20}},
        xaxis=dict(title="Time (seconds)"),
        yaxis=dict(title="Temperature (°C)", titlefont=dict(color="#FF6B6B"), tickfont=dict(color="#FF6B6B"), side='left'),
        yaxis2=dict(anchor="x", overlaying="y", side="right", range=[0, 100], showticklabels=False, showgrid=False, title=None),
        yaxis3=dict(anchor="x", overlaying="y", side="right", showticklabels=False, showgrid=False, title=None),
        hovermode='x', height=520, showlegend=True,
        legend=dict(orientation="h", yanchor="bottom", y=-0.15, xanchor="center", x=0.5),
        margin=dict(l=60, r=60, t=60, b=100), plot_bgcolor='#f8f9fa', paper_bgcolor='white'
    )
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='#e0e0e0', rangeslider_visible=True,
                     rangeselector=dict(buttons=list([
                         dict(count=1, label="1m", step="minute", stepmode="backward"),
                         dict(count=5, label="5m", step="minute", stepmode="backward"),
                         dict(count=30, label="30m", step="minute", stepmode="backward"),
                         dict(count=1, label="1h", step="hour", stepmode="backward"),
                         dict(step="all", label="All")
                     ])))
    fig.update_yaxes(showgrid=True, gridwidth=1, gridcolor='#e0e0e0')
    
    duration_str = f"{test_duration:.1f}" if test_duration else "0.0"
    
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{system_info['board_model']} Test Report</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body {{ font-family: 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: black; min-height: 100vh; }}
        .container {{ max-width: 1400px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); overflow: hidden; }}
        .header {{ background: #EF8933; color: black; padding: 30px; text-align: center; }}
        .header h1 {{ margin: 0 0 20px 0; font-size: 2.5em; font-weight: 300; }}
        .system-info {{ background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 15px; margin: 20px auto; max-width: 800px; }}
        .system-info-item {{ margin: 8px 0; font-size: 0.95em; line-height: 1.4; }}
        .system-info-label {{ font-weight: 600; display: inline-block; min-width: 120px; }}
        .metadata {{ display: flex; justify-content: center; gap: 40px; margin-top: 20px; flex-wrap: wrap; }}
        .metadata-item {{ text-align: center; }}
        .metadata-value {{ font-size: 2em; font-weight: bold; display: block; }}
        .metadata-label {{ font-size: 0.9em; opacity: 0.9; margin-top: 5px; }}
        .content {{ padding: 30px; }}
        .test-section {{ margin-bottom: 40px; }}
        .test-title {{ font-size: 1.5em; color: #333; padding-bottom: 10px; border-bottom: 2px solid #EF8933; }}
        .chart-container {{ margin-bottom: 40px; padding: 20px; background: #f8f9fa; border-radius: 10px; }}
        .footer {{ text-align: center; padding: 20px; color: #666; font-size: 0.9em; border-top: 1px solid #e0e0e0; }}
        .placeholder {{ padding: 40px; text-align: center; background: #f8f9fa; border-radius: 10px; color: #999; font-style: italic; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 {system_info['board_model']} Test Report</h1>
            {f'<h2 style="color: #333; margin-top: -10px; margin-bottom: 20px; font-weight: normal;">{system_info["test_name"]}</h2>' if system_info.get('test_name') else ''}
            <div class="system-info">
                <div class="system-info-item"><span class="system-info-label">Hostname:</span>{system_info['hostname']}</div>
                <div class="system-info-item"><span class="system-info-label">Kernel:</span>{system_info['kernel_version']}</div>
                <div class="system-info-item"><span class="system-info-label">Distribution:</span>{system_info['linux_distro']}</div>
            </div>
            <div class="metadata">
                <div class="metadata-item"><span class="metadata-value">{duration_str}</span><span class="metadata-label">Minutes</span></div>
                <div class="metadata-item"><span class="metadata-value">{datetime.now().strftime('%Y-%m-%d')}</span><span class="metadata-label">Test Date</span></div>
            </div>
        </div>
        <div class="content">
            <div class="test-section">
                <h2 class="test-title">📊 System Monitoring</h2>
                <div class="chart-container"><div id="temperatureChart"></div></div>
            </div>
            <div class="test-section">
                <h2 class="test-title">🎮 GPU Performance</h2>
                {f'<div style="padding: 20px; background: #e8f5e9; border-radius: 10px; text-align: center; color: #2e7d32;"><strong>✓ GPU Stress Test Executed Successfully</strong></div>' if gpu_stress_status == 'success' else ''}
                {gpu_graph_html if gpu_graph_html else '<div class="placeholder">GPU stress test was not run</div>'}
            </div>
            <div class="test-section">
                <h2 class="test-title">🌐 Network Performance</h2>
                {network_graph_html if network_graph_html else '<div class="placeholder">Network metrics were not recorded or interface was offline</div>'}
            </div>
            <div class="test-section">
                <h2 class="test-title">💻 CPU Stress</h2>
                {f'<div style="padding: 20px; background: #e8f5e9; border-radius: 10px; text-align: center; color: #2e7d32;"><strong>✓ CPU Stress Test Executed Successfully</strong></div>' if cpu_stress_status == 'success' else '<div class="placeholder">CPU stress test was not run</div>'}
                {f'<pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; font-size: 12px;">{cpu_stress_log_content}</pre>' if cpu_stress_log_content else ''}
            </div>
        </div>
        <div class="footer">Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | RK3576 Board Test Suite</div>
    </div>
    <script>
        var figure = {fig.to_json()};
        if (figure.data && figure.data.length > 0) {{
            Plotly.newPlot('temperatureChart', figure.data, figure.layout, {{responsive: true}});
        }} else {{
            document.getElementById('temperatureChart').innerHTML = '<div class="placeholder">No data available</div>';
        }}
    </script>
</body>
</html>"""
    
    with open(os.path.join(results_dir, 'report.html'), 'w') as f:
        f.write(html_content)
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        generate_combined_report(sys.argv[1])
