import { useState } from 'react'
import { CircleAlertIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { signIn } from './session'

/** 仅展示登录错误（例如 IdP 拒绝授权）；正常情况下未登录会直接跳转到 IdP */
export function LoginPage({ error }: { error: string | undefined }) {
  const [redirecting, setRedirecting] = useState(false)

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t sign you in</AlertTitle>
          <AlertDescription>
            {error ? `The sign-in service returned: ${error}.` : 'Something went wrong while signing in.'} Try again, or
            contact your administrator if this keeps happening.
          </AlertDescription>
        </Alert>
        <Button
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true)
            signIn().catch(() => setRedirecting(false))
          }}
        >
          {redirecting && <Spinner data-icon="inline-start" />}
          Try again
        </Button>
      </div>
    </div>
  )
}
