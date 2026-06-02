"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const PRESET_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface SettingsPopoverProps {
  playbackRate: number;
  contentVoiceURI: string;
  headingVoiceURI: string;
  onRateChange: (rate: number) => void;
  onContentVoiceChange: (voiceURI: string) => void;
  onHeadingVoiceChange: (voiceURI: string) => void;
}

export function SettingsPopover({
  playbackRate,
  contentVoiceURI,
  headingVoiceURI,
  onRateChange,
  onContentVoiceChange,
  onHeadingVoiceChange,
}: SettingsPopoverProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    function loadVoices() {
      const all = window.speechSynthesis.getVoices();
      // Show all voices — no language filter so nothing is hidden (Siri voices, etc.)
      const sorted = [...all].sort((a, b) => {
        // Local (system) voices first, then alphabetical
        if (a.localService !== b.localService) return a.localService ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setVoices(sorted);
    }
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  function VoiceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={voices.length === 0}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Browser default" />
        </SelectTrigger>
        <SelectContent>
          {voices.map((v) => (
            <SelectItem key={v.voiceURI} value={v.voiceURI} className="text-xs">
              {v.name}{v.localService ? "" : " ☁"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Playback settings"
      >
        <Settings className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-4" align="end">
        <p className="text-sm font-semibold">Playback settings</p>

        {/* Speed */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Speed</Label>
          <div className="flex gap-1.5">
            <Select
              value={PRESET_RATES.includes(playbackRate) ? String(playbackRate) : "custom"}
              onValueChange={(v) => v && v !== "custom" && onRateChange(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_RATES.map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-xs">
                    {r}×
                  </SelectItem>
                ))}
                {!PRESET_RATES.includes(playbackRate) && (
                  <SelectItem value="custom" className="text-xs">
                    {playbackRate}× (custom)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <input
              type="number"
              min={0.1}
              max={4}
              step={0.05}
              value={playbackRate}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0.1 && v <= 4) onRateChange(v);
              }}
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <Separator />

        {/* Safari hint — Chrome/Firefox don't expose system voices like Siri */}
        {voices.length > 0 && voices.length < 15 && (
          <p className="text-[11px] text-muted-foreground bg-muted rounded px-2 py-1.5 leading-snug">
            💡 Open in <strong>Safari</strong> to access Siri &amp; Premium system voices
          </p>
        )}

        {/* Content voice */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Content voice</Label>
          <VoiceSelect value={contentVoiceURI} onChange={onContentVoiceChange} />
        </div>

        {/* Heading voice */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Heading voice</Label>
          <VoiceSelect value={headingVoiceURI} onChange={onHeadingVoiceChange} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
