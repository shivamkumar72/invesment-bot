# Investment Bot

A simple AI-based investment recommendation project using HTML/CSS/JS frontend and Node.js backend.

## What this version includes
- Stock search and quote lookup using Yahoo Finance endpoints
- Search history logging for previously searched tickers
- Basic recommendation engine with trend analysis and risk awareness
- Pure frontend with HTML, CSS, and vanilla JavaScript
- Starter Python model script for linear regression prediction

## Run locally
1. Install Node dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open `http://localhost:3000` in your browser.

## Project structure
- `server.js`: Express API and search history logic
- `public/index.html`: Frontend UI
- `public/styles.css`: Styles
- `public/app.js`: Client-side script
- `data/history.json`: Stored search history
- `python/model.py`: Example Python linear regression prediction script

## Next steps
- Add MongoDB persistence for users and portfolios
- Replace local history storage with a database
- Wire `python/model.py` into backend prediction logic via child process
- Add news sentiment analysis and portfolio pages
