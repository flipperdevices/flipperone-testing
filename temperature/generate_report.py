#!/usr/bin/env python3

import sys
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime
import os

def generate_temperature_report(csv_file, output_html):
    """Generate an interactive HTML report from temperature CSV data."""
    
    try:
        # Read CSV file
        df = pd.read_csv(csv_file)
        
        if df.empty:
            print("Error: CSV file is empty")
            return False
        
        # Convert timestamp to datetime
        df['datetime'] = pd.to_datetime(df['datetime'])
        
        # Get all temperature columns (exclude timestamp and datetime)
        temp_columns = [col for col in df.columns if col not in ['timestamp', 'datetime']]
        
        if not temp_columns:
            print("Error: No temperature data found in CSV")
            return False
        
        # Create figure with subplots
        fig = make_subplots(
            rows=1, cols=1,
            subplot_titles=("Temperature Monitoring Over Time",)
        )
        
        # Add traces for each temperature sensor
        colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#FFA07A']
        
        for idx, col in enumerate(temp_columns):
            color = colors[idx % len(colors)]
            
            # Clean the column name for display
            display_name = col.replace('_', ' ').title()
            
            fig.add_trace(
                go.Scatter(
                    x=df['datetime'],
                    y=df[col],
                    mode='lines',
                    name=display_name,
                    line=dict(color=color, width=2),
                    hovertemplate='<b>%{fullData.name}</b><br>' +
                                  'Time: %{x}<br>' +
                                  'Temperature: %{y:.2f}°C<br>' +
                                  '<extra></extra>'
                ),
                row=1, col=1
            )
        
        # Update layout
        fig.update_layout(
            title={
                'text': f'RK3576 Board Temperature Monitoring Report',
                'x': 0.5,
                'xanchor': 'center',
                'font': {'size': 24, 'family': 'Arial, sans-serif'}
            },
            xaxis_title="Time",
            yaxis_title="Temperature (°C)",
            hovermode='x unified',
            height=600,
            showlegend=True,
            legend=dict(
                orientation="v",
                yanchor="top",
                y=1,
                xanchor="left",
                x=1.02
            ),
            margin=dict(l=60, r=200, t=80, b=60),
            plot_bgcolor='#f8f9fa',
            paper_bgcolor='white',
        )
        
        # Update axes
        fig.update_xaxes(
            showgrid=True,
            gridwidth=1,
            gridcolor='#e0e0e0',
            rangeslider_visible=True,
            rangeselector=dict(
                buttons=list([
                    dict(count=1, label="1m", step="minute", stepmode="backward"),
                    dict(count=5, label="5m", step="minute", stepmode="backward"),
                    dict(count=30, label="30m", step="minute", stepmode="backward"),
                    dict(count=1, label="1h", step="hour", stepmode="backward"),
                    dict(step="all", label="All")
                ])
            )
        )
        
        fig.update_yaxes(
            showgrid=True,
            gridwidth=1,
            gridcolor='#e0e0e0'
        )
        
        # Calculate statistics
        stats_html = generate_statistics_table(df, temp_columns)
        
        # Get test metadata
        test_duration = (df['datetime'].iloc[-1] - df['datetime'].iloc[0]).total_seconds() / 60
        total_samples = len(df)
        
        # Create the full HTML document
        html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RK3576 Temperature Monitoring Report</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }}
        .header h1 {{
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }}
        .metadata {{
            display: flex;
            justify-content: center;
            gap: 40px;
            margin-top: 20px;
            flex-wrap: wrap;
        }}
        .metadata-item {{
            text-align: center;
        }}
        .metadata-value {{
            font-size: 2em;
            font-weight: bold;
            display: block;
        }}
        .metadata-label {{
            font-size: 0.9em;
            opacity: 0.9;
            margin-top: 5px;
        }}
        .content {{
            padding: 30px;
        }}
        .chart-container {{
            margin-bottom: 40px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
        }}
        .stats-container {{
            margin-top: 40px;
        }}
        .stats-title {{
            font-size: 1.8em;
            color: #333;
            margin-bottom: 20px;
            text-align: center;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        th {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 500;
        }}
        td {{
            padding: 12px;
            border-bottom: 1px solid #e0e0e0;
        }}
        tr:hover {{
            background: #f5f5f5;
        }}
        .footer {{
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.9em;
            border-top: 1px solid #e0e0e0;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌡️ Temperature Monitoring Report</h1>
            <div class="metadata">
                <div class="metadata-item">
                    <span class="metadata-value">{test_duration:.1f}</span>
                    <span class="metadata-label">Minutes</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-value">{total_samples:,}</span>
                    <span class="metadata-label">Samples</span>
                </div>
                <div class="metadata-item">
                    <span class="metadata-value">{len(temp_columns)}</span>
                    <span class="metadata-label">Sensors</span>
                </div>
            </div>
        </div>
        
        <div class="content">
            <div class="chart-container">
                <div id="temperatureChart"></div>
            </div>
            
            <div class="stats-container">
                <h2 class="stats-title">📊 Temperature Statistics</h2>
                {stats_html}
            </div>
        </div>
        
        <div class="footer">
            Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | RK3576 Board Test Suite
        </div>
    </div>
    
    <script>
        var figure = {fig.to_json()};
        Plotly.newPlot('temperatureChart', figure.data, figure.layout, {{responsive: true}});
    </script>
</body>
</html>
"""
        
        # Write HTML file
        with open(output_html, 'w') as f:
            f.write(html_content)
        
        print(f"Report successfully generated: {output_html}")
        return True
        
    except Exception as e:
        print(f"Error generating report: {e}")
        return False

def generate_statistics_table(df, temp_columns):
    """Generate HTML table with temperature statistics."""
    
    stats_rows = []
    
    for col in temp_columns:
        # Calculate statistics
        min_temp = df[col].min()
        max_temp = df[col].max()
        avg_temp = df[col].mean()
        std_temp = df[col].std()
        
        # Clean column name for display
        display_name = col.replace('_', ' ').title()
        
        stats_rows.append(f"""
        <tr>
            <td><strong>{display_name}</strong></td>
            <td>{min_temp:.2f}°C</td>
            <td>{max_temp:.2f}°C</td>
            <td>{avg_temp:.2f}°C</td>
            <td>{std_temp:.2f}°C</td>
        </tr>
        """)
    
    return f"""
    <table>
        <thead>
            <tr>
                <th>Sensor</th>
                <th>Min Temperature</th>
                <th>Max Temperature</th>
                <th>Average Temperature</th>
                <th>Std Deviation</th>
            </tr>
        </thead>
        <tbody>
            {''.join(stats_rows)}
        </tbody>
    </table>
    """

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python generate_report.py <input_csv> <output_html>")
        sys.exit(1)
    
    csv_file = sys.argv[1]
    output_html = sys.argv[2]
    
    if not os.path.exists(csv_file):
        print(f"Error: CSV file '{csv_file}' not found")
        sys.exit(1)
    
    success = generate_temperature_report(csv_file, output_html)
    sys.exit(0 if success else 1)