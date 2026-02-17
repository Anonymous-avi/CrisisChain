import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ControlCenter from "./pages/ControlCenter";
import Incidents from "./pages/Incidents";
import Responders from "./pages/Responders";
import Analytics from "./pages/Analytics";
import "./App.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ControlCenter />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/responders" element={<Responders />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
