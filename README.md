# Top-Down Parser Visualizer (RDP & LL(1))

An interactive web application for learning and visualizing compiler design Top-Down Parsing algorithms: **Recursive Descent Parsing (RDP)** and **LL(1) Parsing**.

## 🌟 Features

- **Recursive Descent Parser (RDP)**:
  - Step-by-step procedural simulation (call stack, enter/return moves).
  - Dynamic parse tree SVG rendering as parsing proceeds.
  - Visible backtracking when an alternative production fails.
  - Real-time token consumption strip and ACCEPT/REJECT verdicts.

- **LL(1) Parser**:
  - **FIRST & FOLLOW Sets**: Step-by-step derivation explaining rule sources or instant computation.
  - **Parsing Table Construction**: Visual cell population with First/Follow derivations and automated grammar conflict detection (non-LL(1) warning).
  - **String Parsing Engine**: Classic 3-column trace (Stack, Input, Action) with step-by-step animation and full trace log.

- **Built-in Examples**: Arithmetic expressions, grammar with backtracking, conflict grammars, and more.
- **User Guide**: Built-in guide covering grammar conventions, symbol notation, and algorithmic details.

## 🚀 Getting Started

No external dependencies required! You can open the HTML files directly or host using a lightweight server.

### Option 1: Direct File
Open `index.html` directly in your browser.

### Option 2: Node.js Server
```bash
node server.js
```
Then visit `http://localhost:3000`.

### Option 3: Python Server
```bash
python -m http.server 3000
```
Visit `http://localhost:3000`.

## 📁 Project Structure

```
TopDownParser/
├── css/
│   └── style.css          # Styling & animations
├── js/
│   ├── grammar.js         # Core grammar engine (FIRST, FOLLOW, Table, RDP)
│   ├── rdp-ui.js          # RDP interface & SVG parse tree renderer
│   └── ll1-ui.js          # LL(1) tabs, table builder, and tracer
├── index.html             # Home portal
├── rdp.html               # Recursive Descent Parser visualizer
├── ll1.html               # LL(1) Parser visualizer
├── guide.html             # User guide & documentation
├── package.json
└── server.js
```
