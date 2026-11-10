// Top bar with the signed-in account and Sign out.
import type { Profile } from '../../../shared/api'
import { Button } from '@/components/ui/button'

export function AccountHeader({
  profile,
  onSignOut,
}: {
  profile?: Profile
  onSignOut: () => void
}) {
  const name = profile?.name ?? 'Google account'
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <span className="text-lg font-semibold tracking-tight">auto-yt</span>
      <div className="flex items-center gap-3">
        {profile?.pictureUrl ? (
          <img
            src={profile.pictureUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-8 rounded-full"
          />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-medium">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="text-sm">{name}</span>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  )
}
