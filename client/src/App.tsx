import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

const Index = lazy(() => import("@/pages"));
const Layout = lazy(() => import("@/pages/layout.tsx"));
const Login = lazy(() => import("@/pages/login.tsx"));
const Settings = lazy(() => import("@/pages/settings.tsx"));

function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="flex h-dvh items-center justify-center">
            Loading...
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<Layout />}>
            <Route path="/room?/:id?" element={<Index />} />

            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
