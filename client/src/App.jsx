import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import QuizPage from './pages/QuizPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <img src="/kemet-logo.svg" alt="Kemet Services" className="app-logo" />
          <h1>Kemet Quiz</h1>
          <p>Transformez vos PDF en quiz interactifs</p>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<AdminPage />} />
            <Route path="/quiz/:id" element={<QuizPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
