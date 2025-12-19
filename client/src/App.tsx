import { BrowserRouter, Routes, Route } from "react-router";
import Index from "@/pages";
import Room from "@/pages/room.tsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/room/:id?" element={<Room />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
