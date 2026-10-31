import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/transport'
import {
  disablePush,
  enablePush,
  preparePush,
  pushAvailability,
  registeredPushSubscription,
} from '@/lib/web-push'

/** Device-local opt-in, rendered in the shared desktop web/mobile settings pane. */
export function WebPushSettings() {
  const [unavailable] = useState(pushAvailability)
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (unavailable) return
    let disposed = false
    void Promise.all([preparePush(), invoke<string>('get_web_push_key')])
      .then(async ([worker, key]) => {
        const current = await registeredPushSubscription(worker)
        if (disposed) return
        setRegistration(worker)
        setPublicKey(key)
        setSubscription(current)
      })
      .catch(error => {
        if (!disposed) setError(String(error))
      })
    return () => {
      disposed = true
    }
  }, [unavailable])

  const toggle = async () => {
    if (!registration || !publicKey) return
    setBusy(true)
    setError(null)
    // enablePush requests permission immediately, while the tap is still active.
    const operation = subscription
      ? disablePush(subscription)
      : enablePush(registration, publicKey)
    const id = toast.loading(
      subscription ? 'Disabling notifications…' : 'Enabling notifications…'
    )
    try {
      const next = await operation
      setSubscription(next ?? null)
      toast.success(
        next
          ? 'Notifications enabled on this device'
          : 'Notifications disabled on this device',
        { id }
      )
    } catch (error) {
      setSubscription(
        await registeredPushSubscription(registration).catch(() => null)
      )
      setError(String(error))
      toast.error(String(error), { id })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    if (!subscription) return
    setBusy(true)
    const id = toast.loading('Sending test notification…')
    try {
      await invoke('test_web_push', { endpoint: subscription.endpoint })
      toast.success('Test notification sent', { id })
    } catch (error) {
      if (registration)
        setSubscription(
          await registeredPushSubscription(registration).catch(() => null)
        )
      setError(String(error))
      toast.error(String(error), { id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="web-push-settings">
      <div className="text-sm font-medium">Push notifications</div>
      <p className="text-sm text-muted-foreground">
        Receive a notification on this device when a session finishes or needs
        your input, even when Jean is closed. Notification text does not include
        your conversation.
      </p>
      {unavailable ? (
        <p className="text-sm text-muted-foreground">{unavailable}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {subscription ? 'Enabled on this device.' : 'Off on this device.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !registration || !publicKey}
              onClick={() => void toggle()}
            >
              {subscription ? 'Disable notifications' : 'Enable notifications'}
            </Button>
            {subscription && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void test()}
              >
                Send test
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
