import React, { useState, useEffect, useRef } from 'react';

const TASK_TEMPLATES = [
  {
    title: "Hacker News Top Stories",
    prompt: "Go to news.ycombinator.com, find the top 5 articles with their titles and points, and list them in a clear summary table."
  },
  {
    title: "Wikipedia Summary",
    prompt: "Go to wikipedia.org, search for 'Antigravity', and summarize the first paragraph of the page."
  },
  {
    title: "Ebay Product Search",
    prompt: "Go to ebay.com, search for 'refurbished mechanical keyboard', and extract the titles and prices of the first 3 listings."
  },
  {
    title: "Google Forms Automator",
    prompt: "Go to https://forms.gle/4aV7W2pP4yq1m2R98 (or a dummy login page), and demonstrate clicking input fields and filling out dummy information."
  }
];

export default function App() {
  const [task, setTask] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [modelName, setModelName] = useState("gemini-1.5-flash");
  const [headless, setHeadless] = useState(true);
  const [maxSteps, setMaxSteps] = useState(15);
  
  const [status, setStatus] = useState("idle"); // idle, running, success, error, cancelled
  const [activeTab, setActiveTab] = useState("live"); // live, terminal, results
  
  const [logs, setLogs] = useState([]);
  const [currentScreenshot, setCurrentScreenshot] = useState("");
  const [thinking, setThinking] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [nextGoal, setNextGoal] = useState("");
  const [currentActions, setCurrentActions] = useState([]);
  const [finalResult, setFinalResult] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  
  const [historyList, setHistoryList] = useState([]);
  const socketRef = useRef(null);
  const terminalEndRef = useRef(null);

  // Save API key to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("gemini_api_key", apiKey);
  }, [apiKey]);

  // Scroll to bottom of terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Load history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch("http://localhost:8000/api/history");
      const data = await response.json();
      setHistoryList(data);
    } catch (err) {
      console.error("Error fetching task history:", err);
    }
  };

  const clearHistory = async () => {
    try {
      await fetch("http://localhost:8000/api/history/clear", { method: "POST" });
      setHistoryList([]);
    } catch (err) {
      console.error("Error clearing history:", err);
    }
  };

  const addLog = (text, type = "system") => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, type, text }]);
  };

  const startTask = () => {
    if (!task.trim()) {
      alert("Please enter a task description first.");
      return;
    }
    
    // Clear state
    setStatus("running");
    setLogs([]);
    setCurrentScreenshot("");
    setThinking("Initializing browser session...");
    setEvaluation("");
    setNextGoal("Setting up connection...");
    setCurrentActions([]);
    setFinalResult("");
    setCurrentUrl("");
    setCurrentTitle("");
    setActiveTab("live");
    
    addLog(`Starting task: "${task}"`, "system");
    addLog(`Model: ${modelName} | Headless: ${headless ? "Yes" : "No"} | Max Steps: ${maxSteps}`, "system");

    // Connect to WebSocket
    const ws = new WebSocket("ws://localhost:8000/ws");
    socketRef.current = ws;

    ws.onopen = () => {
      addLog("WebSocket connection established. Launching agent...", "system");
      ws.send(JSON.stringify({
        action: "start",
        task,
        api_key: apiKey,
        model_name: modelName,
        headless,
        max_steps: maxSteps
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "status") {
        addLog(data.message, "system");
      }
      else if (data.type === "step_update") {
        setThinking(data.thinking || "");
        setEvaluation(data.evaluation || "");
        setNextGoal(data.next_goal || "");
        setCurrentActions(data.actions || []);
        setCurrentUrl(data.url || "");
        setCurrentTitle(data.title || "");
        
        if (data.screenshot) {
          setCurrentScreenshot(data.screenshot);
        }
        
        addLog(`--- Step ${data.step} ---`, "system");
        if (data.thinking) {
          addLog(`[Thinking] ${data.thinking}`, "system");
        }
        if (data.actions && data.actions.length > 0) {
          data.actions.forEach(act => {
            addLog(`ACTION: ${act.name} (${JSON.stringify(act.args)})`, "action");
          });
        } else {
          addLog(`ACTION: Wait/Observe`, "action");
        }
      }
      else if (data.type === "completed") {
        setStatus(data.success ? "success" : "error");
        setFinalResult(data.final_result || "No output provided.");
        addLog(`Task completed. Success: ${data.success}`, "success");
        if (data.final_result) {
          addLog(`Result: ${data.final_result}`, "success");
        }
        setActiveTab("results");
        cleanupSocket();
        fetchHistory();
      }
      else if (data.type === "error") {
        setStatus("error");
        setFinalResult(`An error occurred: ${data.error}`);
        addLog(`Error during execution: ${data.error}`, "error");
        setActiveTab("results");
        cleanupSocket();
        fetchHistory();
      }
      else if (data.type === "cancelled") {
        setStatus("cancelled");
        setFinalResult("Task cancelled by user.");
        addLog(`Task execution cancelled.`, "error");
        cleanupSocket();
        fetchHistory();
      }
    };

    ws.onclose = () => {
      addLog("WebSocket disconnected.", "system");
      if (status === "running") {
        setStatus("idle");
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      addLog("WebSocket connection error.", "error");
      setStatus("error");
    };
  };

  const stopTask = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      addLog("Sending cancel request to backend...", "system");
      socketRef.current.send(JSON.stringify({ action: "stop" }));
    }
  };

  const cleanupSocket = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  };

  const loadPastTask = (pastRun) => {
    setTask(pastRun.task);
    setModelName(pastRun.model);
    setStatus(pastRun.status);
    setFinalResult(pastRun.final_result || "");
    
    // Convert past steps to logs
    const historyLogs = [];
    pastRun.steps.forEach(step => {
      historyLogs.push({ time: "", type: "system", text: `--- Step ${step.step} ---` });
      if (step.thinking) {
        historyLogs.push({ time: "", type: "system", text: `[Thinking] ${step.thinking}` });
      }
      if (step.actions && step.actions.length > 0) {
        step.actions.forEach(act => {
          historyLogs.push({ time: "", type: "action", text: `ACTION: ${act.name} (${JSON.stringify(act.args)})` });
        });
      }
    });
    
    if (pastRun.final_result) {
      historyLogs.push({ time: "", type: "success", text: `Final Result: ${pastRun.final_result}` });
    }
    
    setLogs(historyLogs);
    setThinking("");
    setEvaluation("");
    setNextGoal("Loaded from history");
    setCurrentActions([]);
    setCurrentScreenshot("");
    setCurrentUrl(pastRun.steps[pastRun.steps.length - 1]?.url || "");
    setCurrentTitle(pastRun.steps[pastRun.steps.length - 1]?.title || "");
    
    setActiveTab("results");
  };

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header glass">
        <div className="logo-section">
          <div className="logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <span className="logo-text">AeroBrowse</span>
        </div>
        <div className={`status-badge ${status}`}>
          <span className="status-dot"></span>
          {status}
        </div>
      </header>

      {/* DASHBOARD GRID */}
      <main className="dashboard-grid">
        {/* LEFT COLUMN: CONTROLS & SETTINGS */}
        <section className="sidebar-panel">
          {/* Agent Prompter */}
          <div className="glass card-content">
            <h2 className="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{color: "var(--accent-purple)"}}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Agent Task
            </h2>
            <div className="form-group">
              <label htmlFor="prompt-input">What should the agent do?</label>
              <textarea
                id="prompt-input"
                rows="4"
                placeholder="Describe your browser task in plain English..."
                value={task}
                onChange={(e) => setTask(e.target.value)}
                disabled={status === "running"}
              />
            </div>
            
            {status === "running" ? (
              <button className="btn btn-danger" onClick={stopTask}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                </svg>
                Stop Agent
              </button>
            ) : (
              <button className="btn btn-primary" onClick={startTask}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Run Browser Agent
              </button>
            )}
          </div>

          {/* Quick Templates */}
          <div className="glass card-content">
            <h2 className="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{color: "var(--accent-cyan)"}}>
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              Task Templates
            </h2>
            <div className="template-grid">
              {TASK_TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  className="template-card"
                  onClick={() => setTask(tmpl.prompt)}
                  disabled={status === "running"}
                >
                  <strong>{tmpl.title}</strong>
                </button>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div className="glass card-content">
            <h2 className="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{color: "var(--text-secondary)"}}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Config Panel
            </h2>
            
            <div className="form-group">
              <label htmlFor="api-key-input">Gemini API Key</label>
              <input
                id="api-key-input"
                type="password"
                placeholder="Enter Gemini API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="model-select">LLM Model</label>
              <select
                id="model-select"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                disabled={status === "running"}
              >
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Precise)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </div>

            <div className="form-group">
              <label>Max Actions/Steps: {maxSteps}</label>
              <input
                type="range"
                min="5"
                max="50"
                value={maxSteps}
                onChange={(e) => setMaxSteps(parseInt(e.target.value))}
                disabled={status === "running"}
                style={{accentColor: "var(--accent-purple)"}}
              />
            </div>

            <label className="checkbox-group">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                disabled={status === "running"}
              />
              Run Headless (Browser hidden)
            </label>
          </div>
        </section>

        {/* MIDDLE COLUMN: LIVE BROWSER STREAM & TAB VIEW */}
        <section className="center-panel">
          <div className="view-tabs">
            <button
              className={`tab-btn ${activeTab === "live" ? "active" : ""}`}
              onClick={() => setActiveTab("live")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Live Browser View
            </button>
            <button
              className={`tab-btn ${activeTab === "terminal" ? "active" : ""}`}
              onClick={() => setActiveTab("terminal")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              Action Logs
            </button>
            <button
              className={`tab-btn ${activeTab === "results" ? "active" : ""}`}
              onClick={() => setActiveTab("results")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Extracted Results
            </button>
          </div>

          <div className="panel-body glass">
            {activeTab === "live" && (
              <div className="live-view-container">
                <div className="live-view-header">
                  <div className="browser-dots">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                  </div>
                  <div className="browser-address-bar">
                    {currentUrl || "about:blank"}
                  </div>
                  <div style={{width: 32}}></div>
                </div>
                <div className="screenshot-display">
                  {currentScreenshot ? (
                    <img
                      src={`data:image/png;base64,${currentScreenshot}`}
                      alt="Browser Screenshot"
                      className="screenshot-img"
                    />
                  ) : (
                    <div className="live-view-placeholder">
                      {status === "running" ? (
                        <>
                          <div className="radar-loader"></div>
                          <p>Waiting for first browser screenshot...</p>
                        </>
                      ) : (
                        <>
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{color: "var(--text-muted)"}}>
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                          <p>Start a task to load browser instance.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "terminal" && (
              <div className="terminal-container">
                <div className="terminal-header">
                  <span>AeroBrowse CLI Logs</span>
                  <span>UTF-8</span>
                </div>
                <div className="terminal-body">
                  {logs.map((log, index) => (
                    <div key={index} className="terminal-line">
                      {log.time && <span className="line-time">[{log.time}]</span>}
                      <span className="line-prefix">&gt;</span>
                      <span className={`line-content ${log.type}`}>{log.text}</span>
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            )}

            {activeTab === "results" && (
              <div className="results-container">
                {finalResult ? (
                  <div className="results-markdown">
                    <h3 style={{fontSize: 18, color: "var(--accent-purple)"}}>Execution Output</h3>
                    <p style={{whiteSpace: "pre-wrap", marginTop: 12}}>{finalResult}</p>
                  </div>
                ) : (
                  <div className="results-placeholder">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>No extracted results yet. Complete a task to view output data.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: AGENT'S COGNITIVE MIND & HISTORY */}
        <section className="mind-panel">
          {/* Agent's Mind */}
          <div className="glass card-content" style={{flex: 1, display: "flex", flexDirection: "column"}}>
            <h2 className="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{color: "var(--accent-cyan)"}}>
                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
              </svg>
              Cognitive State
            </h2>
            
            <div style={{display: "flex", flexDirection: "column", gap: 14, flex: 1, overflowY: "auto"}}>
              <div className="mind-section">
                <div className="mind-label">Next Target Goal</div>
                <div className={`mind-content ${!nextGoal ? "empty" : ""}`}>
                  {nextGoal || "Awaiting task execution..."}
                </div>
              </div>

              <div className="mind-section">
                <div className="mind-label">Reasoning / Thought Process</div>
                <div className={`mind-content ${!thinking ? "empty" : ""}`}>
                  {thinking || "Awaiting reasoning cycle..."}
                </div>
              </div>

              <div className="mind-section">
                <div className="mind-label">Evaluation of Progress</div>
                <div className={`mind-content ${!evaluation ? "empty" : ""}`}>
                  {evaluation || "Awaiting step evaluation..."}
                </div>
              </div>

              <div className="mind-section">
                <div className="mind-label">Active Operations</div>
                <div className="mind-content" style={{fontFamily: "'Fira Code', monospace"}}>
                  {currentActions && currentActions.length > 0 ? (
                    currentActions.map((act, index) => (
                      <div key={index} style={{color: "var(--accent-purple)", marginBottom: 4}}>
                        • {act.name}({JSON.stringify(act.args)})
                      </div>
                    ))
                  ) : (
                    <span className="text-muted" style={{fontStyle: "italic"}}>Idle</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Past History */}
          <div className="glass card-content">
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <h2 className="panel-title" style={{margin: 0}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Task History
              </h2>
              {historyList.length > 0 && (
                <button
                  onClick={clearHistory}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--error)",
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: 600,
                    textTransform: "uppercase"
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="history-list">
              {historyList.length > 0 ? (
                historyList.map((past, idx) => (
                  <div
                    key={idx}
                    className="history-item"
                    onClick={() => loadPastTask(past)}
                  >
                    <div className="history-item-header">
                      <span>{past.started_at ? new Date(past.started_at).toLocaleDateString() : ""}</span>
                      <span className={`history-item-status ${past.status}`}>{past.status}</span>
                    </div>
                    <div className="history-item-title">{past.task}</div>
                  </div>
                ))
              ) : (
                <div style={{color: "var(--text-muted)", fontSize: 13, fontStyle: "italic", textAlign: "center", padding: 12}}>
                  No past tasks recorded.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
