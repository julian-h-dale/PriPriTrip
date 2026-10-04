import { useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { useInstallPrompt } from "@/shared/pwa/useInstallPrompt";

/**
 * "Install app": the browser's own prompt where there is one (Android/Chrome),
 * or a short how-to on iOS, which has none. Hidden once installed.
 */
export function InstallAppButton({ variant = "outline", className }) {
  const { mode, install } = useInstallPrompt();
  const [hintOpen, setHintOpen] = useState(false);
  if (!mode) return null;

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={className}
        onClick={mode === "prompt" ? install : () => setHintOpen(true)}
      >
        <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Install app
      </Button>
      <Dialog open={hintOpen} onClose={() => setHintOpen(false)} title="Install PriPriTrip">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            Tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> in Safari’s toolbar.
          </li>
          <li>Choose “Add to Home Screen”.</li>
          <li>Open PriPriTrip from the home screen. Trips you’ve loaded work offline.</li>
        </ol>
        <DialogFooter>
          <Button onClick={() => setHintOpen(false)}>Got it</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
