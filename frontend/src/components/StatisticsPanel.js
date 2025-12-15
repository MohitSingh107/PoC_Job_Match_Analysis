import React from 'react';
import { BarChart3, TrendingUp, Briefcase, DollarSign, Lightbulb } from 'lucide-react';
import './StatisticsPanel.css';

const StatisticsPanel = ({ stats }) => {
  const topSkills = stats.most_frequently_required_skills?.slice(0, 10) || [];
  const topTechnologies = stats.most_frequently_required_technologies?.slice(0, 10) || [];
  const topIndustries = stats.top_industries || [];
  const keyInsights = stats.key_insights || [];

  const SkillBar = ({ skill, percentage }) => (
    <div className="skill-bar-item">
      <div className="skill-label">
        <span>{skill}</span>
        <span className="skill-percentage">{percentage}%</span>
      </div>
      <div className="skill-bar-container">
        <div 
          className="skill-bar-fill" 
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );

  return (
    <div className="statistics-panel">
      <div className="statistics-header">
        <BarChart3 className="w-6 h-6" />
        <h2>Job Market Insights</h2>
        <p>Based on {stats.job_descriptions_analyzed?.toLocaleString() || 0} job descriptions analyzed</p>
      </div>

      <div className="statistics-grid">
        {/* Top Skills */}
        <div className="stat-card">
          <div className="stat-card-header">
            <TrendingUp className="w-5 h-5" />
            <h3>Most Frequently Required Skills</h3>
          </div>
          <div className="stat-card-content">
            {topSkills.map((skill, idx) => (
              <SkillBar
                key={idx}
                skill={skill.skill}
                percentage={skill.percentage}
              />
            ))}
          </div>
        </div>

        {/* Top Technologies */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Briefcase className="w-5 h-5" />
            <h3>Most Frequently Required Technologies</h3>
          </div>
          <div className="stat-card-content">
            {topTechnologies.map((tech, idx) => (
              <SkillBar
                key={idx}
                skill={tech.technology}
                percentage={tech.percentage}
              />
            ))}
          </div>
        </div>

        {/* Salary Ranges */}
        {stats.average_salary_range && (
          <div className="stat-card">
            <div className="stat-card-header">
              <DollarSign className="w-5 h-5" />
              <h3>Average Salary Ranges</h3>
            </div>
            <div className="stat-card-content">
              <div className="salary-item">
                <span className="salary-level">Entry Level</span>
                <span className="salary-amount">{stats.average_salary_range.entry_level}</span>
              </div>
              <div className="salary-item">
                <span className="salary-level">Mid Level</span>
                <span className="salary-amount">{stats.average_salary_range.mid_level}</span>
              </div>
              <div className="salary-item">
                <span className="salary-level">Senior Level</span>
                <span className="salary-amount">{stats.average_salary_range.senior_level}</span>
              </div>
            </div>
          </div>
        )}

        {/* Top Industries */}
        {topIndustries.length > 0 && (
          <div className="stat-card">
            <div className="stat-card-header">
              <Briefcase className="w-5 h-5" />
              <h3>Top Industries Hiring</h3>
            </div>
            <div className="stat-card-content">
              {topIndustries.map((industry, idx) => (
                <div key={idx} className="industry-item">
                  <span className="industry-name">{industry.industry}</span>
                  <div className="industry-bar-container">
                    <div 
                      className="industry-bar-fill" 
                      style={{ width: `${industry.percentage}%` }}
                    ></div>
                    <span className="industry-percentage">{industry.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Key Insights */}
      {keyInsights.length > 0 && (
        <div className="insights-section">
          <div className="insights-header">
            <Lightbulb className="w-5 h-5" />
            <h3>Key Market Insights</h3>
          </div>
          <ul className="insights-list">
            {keyInsights.map((insight, idx) => (
              <li key={idx}>{insight}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default StatisticsPanel;

