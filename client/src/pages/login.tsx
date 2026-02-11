import Footer from "@/components/footer.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { authClient } from "@/lib/auth-client.ts";
import { useState } from "react";

const Login = () => {
  const [isLoading, setIsLoading] = useState(false);

  const onSignIn = () => {
    setIsLoading(true);
    authClient.signIn
      .oauth2({
        providerId: "easy-auth",
        callbackURL: `${window.location.origin}`,
      })
      .finally(() => setIsLoading(false));
  };

  return (
    <main className="flex flex-col items-center justify-center h-screen relative">
      <div className="flex gap-8">
        <h1 className="font-mono text-4xl font-semibold">Web Chat</h1>

        <Separator className="w-px" orientation="vertical" />

        <Button onClick={onSignIn} disabled={isLoading}>
          {isLoading && <Spinner />}
          Sign in
        </Button>
      </div>

      <Footer classname="absolute bottom-2" />
    </main>
  );
};

export default Login;
