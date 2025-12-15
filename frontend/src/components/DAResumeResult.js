import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Award } from 'lucide-react';
import { config } from '../config';
import ComparisonGraph from './ComparisonGraph';
import StatisticsPanel from './StatisticsPanel';
import './DAResumeResult.css';

const DAResumeResult = ({ resumeText, onStartOver }) => {
  const [originalAnalysis, setOriginalAnalysis] = useState(null);
  const [improvedResume, setImprovedResume] = useState(null);
  const [improvedAnalysis, setImprovedAnalysis] = useState(null);
  const [jobMarketStats, setJobMarketStats] = useState(null);
  const [curriculumHighlights, setCurriculumHighlights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const analyzeAndImprove = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Step 1: Analyze original resume
      const { data: analysisData } = await axios.post(
        `${config.apiUrl}/api/analyze-da-resume`,
        { text: resumeText }
      );
      setOriginalAnalysis(analysisData);

      // Step 2: Improve resume based on curriculum
      const { data: improvementData } = await axios.post(
        `${config.apiUrl}/api/improve-da-resume`,
        {
          resume_text: resumeText,
          analysis: analysisData.analysis
        }
      );
      setImprovedResume(improvementData.improved_resume);
      setImprovedAnalysis({
        job_relevance_score: improvementData.job_relevance_score,
        ats_friendliness_score: improvementData.ats_friendliness_score,
        improvements_made: improvementData.improvements_made
      });

      // Step 3: Fetch job market stats
      const { data: statsData } = await axios.get(
        `${config.apiUrl}/api/da-job-market-stats`
      );
      setJobMarketStats(statsData);

      // Step 4: Fetch curriculum highlights
      const { data: highlightsData } = await axios.get(
        `${config.apiUrl}/api/curriculum-highlights`
      );
      setCurriculumHighlights(highlightsData);

    } catch (err) {
      console.error('Error:', err);
      setError(err.response?.data?.error || 'Failed to analyze resume. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [resumeText]);

  useEffect(() => {
    analyzeAndImprove();
  }, [analyzeAndImprove]);

  const ScoreCard = ({ score, label, originalScore, isImproved = false }) => {
    const diff = score - originalScore;
    const isPositive = diff > 0;

    return (
      <div className="score-card-container">
        <div className="score-card">
          <div className="score-label">{label}</div>
          <div className="score-value">{score}/100</div>
          {isImproved && originalScore !== undefined && (
            <div className={`score-change ${isPositive ? 'positive' : 'negative'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{isPositive ? '+' : ''}{diff} points</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const ResumeDisplay = ({ title, resume, scores, isOriginal = false }) => {
    const originalScores = originalAnalysis || {};
    
    return (
      <div className="resume-display-panel">
        <div className="resume-panel-header">
          <h3>{title}</h3>
          <div className="score-badges">
            <ScoreCard
              score={scores.job_relevance_score}
              label="Job Relevance"
              originalScore={isOriginal ? undefined : originalScores.job_relevance_score}
              isImproved={!isOriginal}
            />
            <ScoreCard
              score={scores.ats_friendliness_score}
              label="ATS Friendliness"
              originalScore={isOriginal ? undefined : originalScores.ats_friendliness_score}
              isImproved={!isOriginal}
            />
          </div>
        </div>
        <div className="resume-content">
          <pre className="resume-text">{resume}</pre>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <h2>Analyzing Your Resume...</h2>
        <p>We're evaluating your resume against current Data Analytics job market requirements</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={onStartOver} className="btn-primary">Start Over</button>
      </div>
    );
  }

  return (
    <div className="da-resume-result">
      {/* Top Section: Original vs Improved Resumes */}
      <div className="resume-comparison-section">
        <div className="resume-comparison-header">
          <h2>Resume Analysis Results</h2>
          <p>Compare your original resume with the improved version</p>
        </div>
        
        <div className="resume-comparison-grid">
          <ResumeDisplay
            title="Original Resume"
            resume={resumeText}
            scores={{
              job_relevance_score: originalAnalysis?.job_relevance_score || 0,
              ats_friendliness_score: originalAnalysis?.ats_friendliness_score || 0
            }}
            isOriginal={true}
          />
          
          {improvedResume ? (
            <ResumeDisplay
              title="Improved Resume"
              resume={improvedResume}
              scores={{
                job_relevance_score: improvedAnalysis?.job_relevance_score || originalAnalysis?.job_relevance_score || 0,
                ats_friendliness_score: improvedAnalysis?.ats_friendliness_score || originalAnalysis?.ats_friendliness_score || 0
              }}
              isOriginal={false}
            />
          ) : (
            <div className="resume-display-panel">
              <div className="resume-panel-header">
                <h3>Improved Resume</h3>
                <p>Loading improvements...</p>
              </div>
            </div>
          )}
        </div>

        {/* Improvements Summary */}
        {improvedAnalysis?.improvements_made && (
          <div className="improvements-summary">
            <h3>
              <Award className="w-5 h-5" />
              Improvements Made
            </h3>
            <div className="improvements-grid">
              {improvedAnalysis.improvements_made.skills_added?.length > 0 && (
                <div className="improvement-item">
                  <strong>Skills Added:</strong>
                  <ul>
                    {improvedAnalysis.improvements_made.skills_added.map((skill, idx) => (
                      <li key={idx}>{skill}</li>
                    ))}
                  </ul>
                </div>
              )}
              {improvedAnalysis.improvements_made.technologies_added?.length > 0 && (
                <div className="improvement-item">
                  <strong>Technologies Added:</strong>
                  <ul>
                    {improvedAnalysis.improvements_made.technologies_added.map((tech, idx) => (
                      <li key={idx}>{tech}</li>
                    ))}
                  </ul>
                </div>
              )}
              {improvedAnalysis.improvements_made.projects_suggested?.length > 0 && (
                <div className="improvement-item">
                  <strong>Projects Suggested:</strong>
                  <ul>
                    {improvedAnalysis.improvements_made.projects_suggested.map((project, idx) => (
                      <li key={idx}>{project}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {improvedAnalysis.improvements_made.explanation && (
              <p className="improvement-explanation">
                {improvedAnalysis.improvements_made.explanation}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Middle Section: Comparison Graph */}
      {curriculumHighlights && (
        <ComparisonGraph curriculumHighlights={curriculumHighlights} />
      )}

      {/* Bottom Section: Statistics */}
      {jobMarketStats && (
        <StatisticsPanel stats={jobMarketStats} />
      )}

      {/* Action Buttons */}
      <div className="action-buttons">
        <button onClick={onStartOver} className="btn-secondary">Analyze Another Resume</button>
      </div>
    </div>
  );
};

export default DAResumeResult;

