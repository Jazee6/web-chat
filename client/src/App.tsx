import Index from "@/pages";
import Layout from "@/pages/layout.tsx";
import Login from "@/pages/login.tsx";
import Settings from "@/pages/settings.tsx";
import { BrowserRouter, Route, Routes } from "react-router";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<Layout />}>
          <Route path="/room?/:id?" element={<Index />} />

          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
