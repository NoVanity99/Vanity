import { Ban, LogOut } from 'lucide-react'
import { Button } from '@/components/Dialog'

/**
 * What a banned account sees instead of the launcher. Also shown to admins in "See what they
 * see", so it is one component: what they preview is what the person gets.
 */
export function BannedCard({ name, reason, onSignOut }: { name: string; reason: string; onSignOut?: () => void }): React.JSX.Element {
  return (
    <div className="text-center" data-banned>
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <Ban className="size-7" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">This account has been banned</h2>
      <p className="mt-1 text-sm text-muted">{reason ? `Reason: ${reason}` : "It broke Vanity's rules."}</p>
      <p className="mt-1 text-xs text-muted">Signed in as {name}. If you think this is a mistake, contact Vanity's team.</p>
      <Button className="mt-5" onClick={onSignOut} disabled={!onSignOut}>
        <LogOut className="size-4" /> Sign out
      </Button>
    </div>
  )
}
