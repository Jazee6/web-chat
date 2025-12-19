import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import Footer from "@/components/footer.tsx";
import { authClient, useSession } from "@/lib/auth-client.ts";
import { useEffect } from "react";
import { useNavigate } from "react-router";

const Index = () => {
  const { data } = useSession();
  const nav = useNavigate();

  useEffect(() => {
    if (data?.user) {
      nav("/room");
    }
  }, [data?.user, nav]);

  const onSignIn = () => {
    authClient.signIn.oauth2({
      providerId: "easy-auth",
      callbackURL: `${window.location.origin}/room`,
      scopes: ["openid", "profile", "email", "offline_access"],
    });
  };

  return (
    <main className="flex flex-col items-center justify-center h-screen relative">
      <div className="flex space-x-8">
        <h1 className="font-mono text-4xl font-semibold">Web Chat</h1>

        <Separator orientation="vertical" />

        <Button onClick={onSignIn}>Sign in</Button>
      </div>

      <Footer classname="absolute bottom-2" />
    </main>
  );
};

export default Index;
