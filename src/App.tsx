import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Watch from "@/pages/Watch";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/watch/:roomId" element={<Watch />} />
      </Routes>
    </Router>
  );
}
