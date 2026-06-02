"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

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
      const en = all
        .filter((v) => v.lang.startsWith("en"))
        .sort((a, b) => {
          if (a.localService !== b.localService) return a.localService ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setVoices(en);
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
          <Select value={String(playbackRate)} onValueChange={(v) => v && onRateChange(Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RATES.map((r) => (
                <SelectItem key={r} value={String(r)} className="text-xs">
                  {r}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

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
