import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import nerdamer from 'nerdamer';
import 'nerdamer/all.min';
import 'katex/dist/katex.min.css';
import Latex from 'react-latex-next';

const PRESETS = {
  "Simple Minimum": "x^2 + y^2",
  "Simple Maximum": "-x^2 - y^2",
  "Saddle Point": "x^2 - y^2",
  "Monkey Saddle": "x^3 - 3*x*y^2",
  "Multi-Extrema": "x^4 + y^4 - 4*x*y + 1",
  "Trigonometric": "sin(x) + sin(y)"
};

function App() {
  const [selectedPreset, setSelectedPreset] = useState("Custom");
  const [inputFunc, setInputFunc] = useState(PRESETS["Simple Minimum"]);
  const [results, setResults] = useState(null);
  const [plotData, setPlotData] = useState(null);
  const [error, setError] = useState(null);
  const [vars, setVars] = useState(['x', 'y']); // Store detected variables
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handlePresetChange = (e) => {
    const newVal = e.target.value;
    setSelectedPreset(newVal);
    if (newVal !== "Custom") {
      setInputFunc(PRESETS[newVal]);
    }
  };

  const handleInputChange = (e) => {
    setInputFunc(e.target.value);
    setSelectedPreset("Custom");
  };

  // Debounce analysis
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputFunc.trim().length > 0) analyzeFunction(inputFunc);
    }, 800);
    return () => clearTimeout(timer);
  }, [inputFunc]);

  // Helper: Determinant of a square matrix (array of arrays)
  const getDeterminant = (matrix) => {
    const n = matrix.length;
    if (n === 1) return matrix[0][0];
    if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];

    let det = 0;
    for (let c = 0; c < n; c++) {
      const subMatrix = matrix.slice(1).map(row => row.filter((_, idx) => idx !== c));
      det += matrix[0][c] * Math.pow(-1, c) * getDeterminant(subMatrix);
    }
    return det;
  };

  const analyzeFunction = (expression) => {
    try {
      setError(null);

      // 1. Detect Variables
      let detectedVars = nerdamer(expression).variables().sort();
      // Default to x,y if fewer
      if (detectedVars.length === 0) detectedVars = ['x', 'y'];
      else if (detectedVars.length === 1) detectedVars = [detectedVars[0], detectedVars[0] === 'x' ? 'y' : 'x'];

      setVars(detectedVars);
      const is2D = detectedVars.length === 2;

      // 2. Compute Gradient (First Derivatives)
      const gradient = detectedVars.map(v => {
        const d = nerdamer(`diff(${expression}, ${v})`);
        return { var: v, obj: d, tex: d.toTeX(), text: d.text() };
      });

      // 3. Compute Hessian (Second Derivatives) matrix n x n
      const hessian = detectedVars.map((rowVar) => {
        return detectedVars.map((colVar) => {
          // We can differentiate the already computed first derivative
          const firstDeriv = gradient.find(g => g.var === rowVar).obj;
          const d2 = nerdamer(`diff(${firstDeriv.text()}, ${colVar})`);
          return {
            row: rowVar,
            col: colVar,
            obj: d2,
            tex: d2.toTeX(),
            text: d2.text()
          };
        });
      });

      // 4. Solve System: Gradient = 0
      const equations = gradient.map(g => `${g.text}=0`);
      let solutions = nerdamer.solveEquations(equations);

      // Normalize solutions to array
      if (!Array.isArray(solutions)) solutions = [solutions];

      // helper to extract real numbers safely
      const extractNum = (val) => {
        if (val === undefined || val === null) return 0;
        if (typeof val === 'number') return val;
        try {
          // evaluate symbolic fractions/expressions to float
          return Number(nerdamer(val).evaluate().text());
        } catch (e) { return 0; }
      };

      const processedPoints = solutions.map(sol => {
        // Construct point object mapping { x: val, y: val, z: val }
        const pointCoords = {};

        detectedVars.forEach(v => {
          let val = 0; // Default to 0

          // Debug check: nerdamer might return just a value if 1 var, or object/array if multiple
          // For N-vars, sol should be an object or array of pairs.
          // Sometimes for 1 variable e.g. x^2, sol is just 0.

          if (sol[v] !== undefined) {
            val = extractNum(sol[v]);
          } else if (Array.isArray(sol)) {
            // check for pair ['x', 1]
            const pair = sol.find(p => Array.isArray(p) && p[0] === v);
            if (pair) val = extractNum(pair[1]);
          }
          // If still not found, check if sol is just a number and we have 1 var
          else if (detectedVars.length === 1 && typeof sol === 'number') {
            val = sol;
          }

          if (val === undefined || val === null || isNaN(val)) val = 0;
          pointCoords[v] = Number(val);
        });

        // Evaluate Hessian at this point
        const evaluatedHessian = hessian.map(row => {
          return row.map(cell => {
            return Number(nerdamer(cell.text).evaluate(pointCoords).text());
          });
        });

        // 5. Classify using Principal Minors (Sylvester's Criterion)
        // Calculate Leading Principal Minors (D_k)
        // D_1 = det(1x1), D_2 = det(2x2 top-left), ... D_n = det(nxn)
        const principalMinors = [];
        for (let k = 1; k <= detectedVars.length; k++) {
          // Extract k x k submatrix
          const sub = evaluatedHessian.slice(0, k).map(r => r.slice(0, k));
          principalMinors.push(getDeterminant(sub));
        }

        let classification = "Inconclusive";
        let explanation = "";

        // Check Pos Definite (All Pi > 0) -> Local Min
        const allPos = principalMinors.every(d => d > 0);

        // Check Neg Definite (Alternating signs: -, +, -, +...) -> Local Max
        // P1 < 0, P2 > 0, P3 < 0 ... => P_i has sign (-1)^i
        const alternateNeg = principalMinors.every((d, idx) => {
          const k = idx + 1; // 1-based index
          const requiredSign = Math.pow(-1, k);
          // if k=1 (odd), want neg. if k=2 (even), want pos.
          return (d * requiredSign) > 0;
        });

        const detH = principalMinors[principalMinors.length - 1]; // Full determinant

        if (allPos) {
          classification = "Local Minima";
          explanation = "Hessian is Positive Definite (All D_k > 0)";
        } else if (alternateNeg) {
          classification = "Local Maxima";
          explanation = "Hessian is Negative Definite (Alt. signs -, +, ...)";
        } else if (detH !== 0) {
          classification = "Saddle Point";
          explanation = "Indefinite (Det ≠ 0, fails definite tests)";
        } else {
          classification = "Inconclusive";
          explanation = "Det(H) = 0 (Degenerate critical point)";
        }

        return {
          coords: pointCoords,
          hessianMatrix: evaluatedHessian,
          principalMinors,
          classification,
          explanation
        };
      });

      // Filter unique valid points
      const uniquePoints = [];
      const seen = new Set();
      processedPoints.forEach(p => {
        // Create signature key from coords values
        const vals = detectedVars.map(v => {
          const val = p.coords[v];
          return (val !== undefined && val !== null) ? Number(val).toFixed(4) : 'NaN';
        }).join(',');

        const hasNaN = detectedVars.some(v => isNaN(p.coords[v]));
        if (!seen.has(vals) && !hasNaN) {
          seen.add(vals);
          uniquePoints.push(p);
        }
      });

      setResults({
        gradient,
        hessian,
        points: uniquePoints,
        expression_tex: nerdamer(expression).toTeX(),
        is2D
      });

      // Only plot if 2 Variables
      if (is2D) {
        generatePlot(expression, uniquePoints, detectedVars[0], detectedVars[1]);
      } else {
        setPlotData(null); // Clear plot for >2 vars
      }

    } catch (err) {
      console.error(err);
      setError("Error analyzing function. " + err.message);
    }
  };

  const generatePlot = (expression, points, var1, var2) => {
    try {
      const compile = nerdamer(expression).buildFunction([var1, var2]);
      const size = 30;
      const x_row = [];
      const y_row = [];
      const z_data = [];

      let minX = -3, maxX = 3, minY = -3, maxY = 3;
      if (points.length > 0) {
        const xs = points.map(p => p.coords[var1]);
        const ys = points.map(p => p.coords[var2]);
        const span = 4;
        minX = Math.min(...xs) - span; maxX = Math.max(...xs) + span;
        minY = Math.min(...ys) - span; maxY = Math.max(...ys) + span;
      }

      const stepX = (maxX - minX) / size;
      const stepY = (maxY - minY) / size;

      for (let i = 0; i < size; i++) {
        const y = minY + i * stepY;
        y_row.push(y);
        const row = [];
        for (let j = 0; j < size; j++) {
          const x = minX + j * stepX;
          if (i === 0) x_row.push(x);
          row.push(compile(x, y));
        }
        z_data.push(row);
      }

      const pointsTrace = {
        x: points.map(p => p.coords[var1]),
        y: points.map(p => p.coords[var2]),
        z: points.map(p => { return compile(p.coords[var1], p.coords[var2]) }),
        mode: 'markers',
        type: 'scatter3d',
        marker: { color: points.map(p => p.classification.includes('Maxima') ? '#f87171' : p.classification.includes('Minima') ? '#4ade80' : '#f59e0b'), size: 6 }
      };

      const surfaceTrace = {
        z: z_data,
        x: x_row,
        y: y_row,
        type: 'surface',
        colorscale: 'Viridis',
        opacity: 0.8,
        showscale: false
      };

      setPlotData([surfaceTrace, pointsTrace]);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="container">
      <header>
        <button
          onClick={toggleTheme}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '1.2rem'
          }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <h1>CalcHelper Pro</h1>
        <div className="subtitle">Extrema Analysis for Multivariable Calculus (N-Vars)</div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <h3>Target Function</h3>
          <div className="control-group">
            <label>Choose Example (Optional)</label>
            <select value={selectedPreset} onChange={handlePresetChange}>
              <option value="Custom">Custom Input...</option>
              {Object.keys(PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          <div className="control-group">
            <label>Function f({vars.join(', ')})</label>
            <input
              type="text"
              value={inputFunc}
              onChange={handleInputChange}
              placeholder={`e.g. ${vars[0]}^2 + ${vars[1]}^2`}
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          <div className="math-display">
            {results && !error ? <Latex>{`$$f = ${results.expression_tex}$$`}</Latex> : <span style={{ color: 'var(--accent-red)' }}>{error || '...'}</span>}
          </div>

          <div className="info-box" style={{ marginTop: '2rem' }}>
            <h4>📚 Method: Hessian Matrix</h4>
            <div style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
              For N &gt; 2, we use <strong>Sylvester's Criterion</strong> on the <Latex>Hessian Matrix $H$</Latex>.
            </div>
            <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2rem', marginTop: '0.5rem' }}>
              <li><strong>Local Min:</strong> All Principal Minors &gt; 0 (Pos. Definite)</li>
              <li><strong>Local Max:</strong> Minors alternate -, +, -, +... (Neg. Definite)</li>
              <li><strong>Saddle:</strong> Determinant ≠ 0 but doesn't fit above.</li>
              <li><strong>Inconclusive:</strong> Determinant = 0.</li>
            </ul>
          </div>
        </aside>

        <section className="results">
          {results && (
            <>
              {/* Step 1: Gradient */}
              <div className="step-card">
                <h3><span className="step-number">1</span> Gradient Vector</h3>
                <p>Calculated first partial derivatives for all {vars.length} variables.</p>
                <div className="eq-grid">
                  {results.gradient.map(g => (
                    <div className="eq-item" key={g.var}>
                      <label>f_{g.var}</label>
                      <div className="latex-render"><Latex>{`$$${g.tex}$$`}</Latex></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 2: Hessian */}
              <div className="step-card">
                <h3><span className="step-number">2</span> Hessian Matrix</h3>
                <p>Constructed the {vars.length}x{vars.length} matrix of second derivatives.</p>
                <div style={{ overflowX: 'auto', padding: '1rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
                    <tbody>
                      {results.hessian.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j} style={{ padding: '0.75rem', border: '1px solid var(--glass-border)', textAlign: 'center' }}>
                              <Latex>{`$$f_{${cell.row}${cell.col}} = ${cell.tex}$$`}</Latex>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Step 3: Critical Points */}
              <div className="step-card">
                <h3><span className="step-number">3</span> Critical Points & Classification</h3>
                <p>Solving <Latex>$\nabla f = \vec{0}$</Latex> and analyzing the Hessian Matrix at each point.</p>

                <div className="points-list">
                  {results.points.length === 0 ? <p>No real critical points found.</p> : results.points.map((p, i) => (
                    <div key={i} className={`point-card ${p.classification.replace(" ", "-").toLowerCase()}`}>
                      <div className="point-info" style={{ width: '100%' }}>
                        <div className="point-coords">
                          ({vars.map(v => `${v}=${Number(p.coords[v] || 0).toFixed(3)}`).join(', ')})
                        </div>
                        <div className="explanation">
                          <strong>Minors: </strong> [{p.principalMinors.map(m => m.toFixed(2)).join(', ')}]
                        </div>
                        <div className="classification-box" style={{ textAlign: 'left', marginTop: '0.5rem' }}>
                          <div className="classification-label">{p.classification}</div>
                          <div className="classification-reason">{p.explanation}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 4: Visualization (2D Only) */}
              {results.is2D ? (
                <div className="step-card">
                  <h3><span className="step-number">4</span> Visualization</h3>
                  <div className="plot-wrapper">
                    {plotData && (
                      <Plot
                        data={plotData}
                        layout={{
                          width: undefined,
                          height: 600,
                          autosize: true,
                          title: { text: `Surface: ${inputFunc}`, font: { color: theme === 'dark' ? '#f1f5f9' : '#0f172a', size: 18 } },
                          scene: {
                            xaxis: { title: vars[0], color: theme === 'dark' ? '#94a3b8' : '#64748b' },
                            yaxis: { title: vars[1], color: theme === 'dark' ? '#94a3b8' : '#64748b' },
                            zaxis: { title: `f`, color: theme === 'dark' ? '#94a3b8' : '#64748b' },
                            aspectratio: { x: 1, y: 1, z: 0.7 }
                          },
                          paper_bgcolor: 'rgba(0,0,0,0)',
                          plot_bgcolor: 'rgba(0,0,0,0)',
                          margin: { t: 50, b: 20, l: 0, r: 0 },
                          font: { color: theme === 'dark' ? '#f1f5f9' : '#0f172a' },
                        }}
                        useResizeHandler={true}
                        style={{ width: '100%', height: '100%' }}
                        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="step-card" style={{ opacity: 0.7 }}>
                  <h3><span className="step-number" style={{ background: 'gray' }}>4</span> Visualization Disabled</h3>
                  <p>3D Visualization is only available for functions with 2 variables. This function has {vars.length}.</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
