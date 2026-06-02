"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { KOKORO_VOICES } from "@/lib/kokoro-engine";

const PRESET_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface SettingsPopoverProps {
  playbackRate: number;
  contentVoiceURI: string;
  headingVoiceURI: string;
  onRateChange: (rate: number) => void;
  onContentVoiceChange: (voiceURI: string) => void;
  onHeadingVoiceChange: (voiceURI: string) => void;
  // Kokoro
  useKokoro: boolean;
  kokoroVoice: string;
  onEngineChange: (engine: "webspeech" | "kokoro") => void;
  onKokoroVoiceChange: (voice: string) => void;
}

export function SettingsPopover({
  playbackRate,
  contentVoiceURI,
  headingVoiceURI,
  onRateChange,
  onContentVoiceChange,
  onHeadingVoiceChange,
  useKokoro,
  kokoroVoice,
  onEngineChange,
  onKokoroVoiceChange,
}: SettingsPopoverProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    function loadVoices() {
      const all = window.speechSynthesis.getVoices();
      const sorted = [...all]
        .filter((v) => v.lang.startsWith("en") || v.lang.startsWith("vi"))
        .sort((a, b) => {
          if (a.localService !== b.localService) return a.localService ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setVoices(sorted);
    }
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  function SystemVoiceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const enVoices = voices.filter((v) => v.lang.startsWith("en"));
    const viVoices = voices.filter((v) => v.lang.startsWith("vi"));
    return (
      <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={voices.length === 0}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Browser default" />
        </SelectTrigger>
        <SelectContent>
          {enVoices.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">🇺🇸 English</SelectLabel>
              {enVoices.map((v) => (
                <SelectItem key={v.voiceURI} value={v.voiceURI} className="text-xs">
                  {v.name}{v.localService ? "" : " ☁"}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {viVoices.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">🇻🇳 Tiếng Việt</SelectLabel>
              {viVoices.map((v) => (
                <SelectItem key={v.voiceURI} value={v.voiceURI} className="text-xs">
                  {v.name}{v.localService ? "" : " ☁"}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
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

        {/* Engine toggle */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Voice engine</Label>
          <Select
            value={useKokoro ? "kokoro" : "webspeech"}
            onValueChange={(v) => v && onEngineChange(v as "webspeech" | "kokoro")}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webspeech" className="text-xs">System voice (Web Speech)</SelectItem>
              <SelectItem value="kokoro" className="text-xs">🤖 Kokoro AI — natural, works in background</SelectItem>
            </SelectContent>
          </Select>
          {useKokoro && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              Downloads ~83 MB on first use. Cached after that.
            </p>
          )}
        </div>

        <Separator />

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
                  <SelectItem key={r} value={String(r)} className="text-xs">{r}×</SelectItem>
                ))}
                {!PRESET_RATES.includes(playbackRate) && (
                  <SelectItem value="custom" className="text-xs">{playbackRate}× (custom)</SelectItem>
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

        {useKokoro ? (
          /* Kokoro voice */
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Kokoro voice</Label>
            <Select value={kokoroVoice} onValueChange={(v) => v && onKokoroVoiceChange(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">🇺🇸 American</SelectLabel>
                  {KOKORO_VOICES.filter(v => v.id.startsWith("a")).map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground px-2 py-1">🇬🇧 British</SelectLabel>
                  {KOKORO_VOICES.filter(v => v.id.startsWith("b")).map((v) => (
                    <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : (
          /* System voice selectors */
          <>
            {voices.length > 0 && voices.length < 15 && (
              <p className="text-[11px] text-muted-foreground bg-muted rounded px-2 py-1.5 leading-snug">
                💡 Open in <strong>Safari</strong> to access Siri &amp; Premium system voices
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Content voice</Label>
              <SystemVoiceSelect value={contentVoiceURI} onChange={onContentVoiceChange} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Heading voice</Label>
              <SystemVoiceSelect value={headingVoiceURI} onChange={onHeadingVoiceChange} />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
