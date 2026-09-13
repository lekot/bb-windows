import {
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  stepFontScalePercent,
  typographyProfiles,
  type FontScalePercent,
  type TypographyProfileId,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsWithControl,
} from "@/components/ui/settings-section.js";
import {
  FONT_SCALE_STEPPER_BUTTON_CLASS,
  TYPOGRAPHY_SETTING_DESCRIPTION,
  typographyProfileLabel,
} from "@/components/settings/typography-labels";

interface TypographySettingsControlProps {
  disabled: boolean;
  fontScalePercent: FontScalePercent;
  onTypographyChange: (next: {
    typographyProfile: TypographyProfileId;
    fontScalePercent: FontScalePercent;
  }) => void;
  typographyProfile: TypographyProfileId;
}

export function TypographySettingsControl({
  disabled,
  fontScalePercent,
  onTypographyChange,
  typographyProfile,
}: TypographySettingsControlProps) {
  return (
    <>
      <SettingsWithControl
        label="Typography"
        description={TYPOGRAPHY_SETTING_DESCRIPTION}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-36"
              aria-label="Typography"
              disabled={disabled}
            >
              <span className="min-w-0 truncate">
                {typographyProfileLabel(typographyProfile)}
              </span>
              <Icon
                name="ChevronDown"
                className="size-3.5 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
          >
            {typographyProfiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                disabled={disabled}
                onSelect={() =>
                  onTypographyChange({
                    typographyProfile: profile.id,
                    fontScalePercent,
                  })
                }
              >
                <span>{typographyProfileLabel(profile.id)}</span>
                <span className="text-muted-foreground">{profile.hint}</span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto",
                    typographyProfile !== profile.id && "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsWithControl>

      <SettingsWithControl
        label="Text size"
        description="Scales every text tier except the 10px chrome micro-copy, from 90% to 110%."
      >
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Text size"
        >
          <Button
            variant="outline"
            size="sm"
            className={FONT_SCALE_STEPPER_BUTTON_CLASS}
            disabled={disabled || fontScalePercent <= FONT_SCALE_MIN_PERCENT}
            aria-label="Decrease text size"
            onClick={() =>
              onTypographyChange({
                typographyProfile,
                fontScalePercent: stepFontScalePercent(fontScalePercent, -1),
              })
            }
          >
            <Icon name="ZoomOut" />
          </Button>
          <span
            className="min-w-10 text-center font-mono text-xs"
            aria-live="polite"
          >
            {fontScalePercent}%
          </span>
          <Button
            variant="outline"
            size="sm"
            className={FONT_SCALE_STEPPER_BUTTON_CLASS}
            disabled={disabled || fontScalePercent >= FONT_SCALE_MAX_PERCENT}
            aria-label="Increase text size"
            onClick={() =>
              onTypographyChange({
                typographyProfile,
                fontScalePercent: stepFontScalePercent(fontScalePercent, 1),
              })
            }
          >
            <Icon name="Plus" />
          </Button>
        </div>
      </SettingsWithControl>
    </>
  );
}
