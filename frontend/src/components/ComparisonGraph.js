import React from 'react';
import './ComparisonGraph.css';

const ComparisonGraph = () => {
  const months = [0, 2, 4, 6, 8, 10, 12];
  const conventional = [0, 15, 30, 40, 50, 65, 85];
  const codingNinjas = [0, 25, 55, 75, 100, 100, 100];

  const chartWidth = 760;
  const chartHeight = 360;
  const padding = { top: 40, right: 20, bottom: 60, left: 60 };
  const maxX = 12;
  const maxY = 100;

  const xScale = (month) =>
    padding.left + (month / maxX) * (chartWidth - padding.left - padding.right);

  const yScale = (value) =>
    chartHeight - padding.bottom - (value / maxY) * (chartHeight - padding.top - padding.bottom);

  const toPolyline = (data) =>
    data
      .map((val, idx) => `${xScale(months[idx]).toFixed(1)},${yScale(val).toFixed(1)}`)
      .join(' ');

  const calloutPoint = { month: 8, value: 100 };

  return (
    <section className="graph-cta-section">
      <div className="graph-card">
        <div className="graph-header">
          <h3>Your Path to Becoming Job-Ready</h3>
          <p>See how Coding Ninjas accelerates your learning journey</p>
        </div>

        <div className="graph-wrapper">
          <svg width={chartWidth} height={chartHeight} role="img" aria-label="Job ready timeline comparison">
            {/* background */}
            <rect
              x="0"
              y="0"
              width={chartWidth}
              height={chartHeight}
              rx="12"
              fill="#ffffff"
              stroke="#f2e5de"
            />

            {/* grid lines */}
            {[25, 50, 75, 100].map((tick) => (
              <line
                key={tick}
                x1={padding.left}
                x2={chartWidth - padding.right}
                y1={yScale(tick)}
                y2={yScale(tick)}
                stroke="#e5e7eb"
                strokeDasharray="4 4"
              />
            ))}

            {/* axes */}
            <line
              x1={padding.left}
              y1={chartHeight - padding.bottom}
              x2={chartWidth - padding.right}
              y2={chartHeight - padding.bottom}
              stroke="#cbd5e1"
              strokeWidth="1.5"
            />
            <line
              x1={padding.left}
              y1={padding.top}
              x2={padding.left}
              y2={chartHeight - padding.bottom}
              stroke="#cbd5e1"
              strokeWidth="1.5"
            />

            {/* conventional line */}
            <polyline
              points={toPolyline(conventional)}
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2.5"
              strokeDasharray="3 5"
            />

            {/* coding ninjas fill + line */}
            <polygon
              points={`${toPolyline(codingNinjas)} ${xScale(months[months.length - 1]).toFixed(
                1
              )},${chartHeight - padding.bottom} ${xScale(months[0]).toFixed(1)},${
                chartHeight - padding.bottom
              }`}
              fill="url(#cnGradient)"
              opacity="0.15"
            />
            <polyline
              points={toPolyline(codingNinjas)}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* points */}
            {conventional.map((val, idx) => (
              <circle
                key={`conv-${idx}`}
                cx={xScale(months[idx])}
                cy={yScale(val)}
                r="5"
                fill="#9ca3af"
              />
            ))}
            {codingNinjas.map((val, idx) => (
              <circle
                key={`cn-${idx}`}
                cx={xScale(months[idx])}
                cy={yScale(val)}
                r="6"
                fill="#4f46e5"
                stroke="#e0e7ff"
                strokeWidth="2"
              />
            ))}

            {/* callout */}
            <line
              x1={xScale(calloutPoint.month)}
              y1={yScale(calloutPoint.value)}
              x2={xScale(calloutPoint.month)}
              y2={yScale(calloutPoint.value) + 55}
              stroke="#b4b9c6"
              strokeDasharray="4 4"
            />
            <g transform={`translate(${xScale(calloutPoint.month) - 95}, ${yScale(calloutPoint.value) - 70})`}>
              <rect width="220" height="56" rx="8" fill="#e0e7ff" stroke="#4338ca" strokeWidth="1.5" />
              <text x="14" y="20" fill="#6b7280" fontSize="11" fontWeight="600">
                Key Insight
              </text>
              <text x="14" y="38" fill="#4338ca" fontSize="12" fontWeight="700">
                100% Job-Ready in just 5 months
              </text>
              <text x="14" y="52" fill="#6b7280" fontSize="11">
                vs 85% in 12 months
              </text>
            </g>

            {/* timeline labels */}
            {months.map((month) => (
              <g key={`m-${month}`} transform={`translate(${xScale(month)}, ${chartHeight - padding.bottom})`}>
                <line y1="0" y2="6" stroke="#9ca3af" strokeWidth="1.2" />
                <text y="22" textAnchor="middle" fill="#6b7280" fontSize="12" fontWeight="600">
                  {month === 0 ? 'Month 0' : `Month ${month}`}
                </text>
              </g>
            ))}

            {/* y-axis tick labels */}
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={`y-${tick}`} transform={`translate(${padding.left}, ${yScale(tick)})`}>
                <line x1="-6" x2="0" stroke="#9ca3af" strokeWidth="1.2" />
                <text x="-10" y="4" textAnchor="end" fill="#6b7280" fontSize="11" fontWeight="600">
                  {tick}%
                </text>
              </g>
            ))}

            {/* y-axis label */}
            <text
              x="20"
              y={chartHeight / 2}
              transform={`rotate(-90 20 ${chartHeight / 2})`}
              fill="#6b7280"
              fontSize="12"
              fontWeight="600"
            >
              Job-Ready Percentage
            </text>

            {/* legend */}
            <g transform={`translate(${chartWidth - padding.right - 200}, ${padding.top + 10})`}>
              {/* Conventional Learning */}
              <line x1="0" y1="0" x2="30" y2="0" stroke="#9ca3af" strokeWidth="2.5" strokeDasharray="3 5" />
              <circle cx="15" cy="0" r="4" fill="#9ca3af" />
              <text x="38" y="4" fill="#6b7280" fontSize="12" fontWeight="500">
                Conventional Learning
              </text>
              
              {/* Coding Ninjas Course */}
              <line x1="0" y1="22" x2="30" y2="22" stroke="#4f46e5" strokeWidth="3" />
              <circle cx="15" cy="22" r="5" fill="#4f46e5" stroke="#e0e7ff" strokeWidth="2" />
              <text x="38" y="26" fill="#6b7280" fontSize="12" fontWeight="500">
                Coding Ninjas Course
              </text>
            </g>

            <defs>
              <linearGradient id="cnGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.1" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      <div className="cta-card">
        <h2>
          Ready to Go from <span>40% to 100% Job Match?</span>
        </h2>
        <p>Close your skill gaps with Coding Ninjas and become job-ready in record time.</p>
        <button className="cta-button">Request Callback</button>
      </div>
    </section>
  );
};

export default ComparisonGraph;

