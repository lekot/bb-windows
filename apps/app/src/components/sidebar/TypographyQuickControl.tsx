import { useState } from "react";
import {
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  stepFontScalePercent,
  typographyProfiles,
  type TypographyProfileId,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useAppliedTypography } from "@/hooks/useTypography";
import { useTypographySelection } from "@/hooks/useTypographySelection";
import { getAppliedTypography } from "@/lib/typography";
import {
  FONT_SCALE_STEPPER_BUTTON_CLASS,
  typographyProfileHint,
  typographyProfileLabel,
} from "@/components/settings/typography-labels";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "@/components/sidebar/sidebarRowClasses";

const PROFILE_OPTION_CLASS =
  "flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-1 focus-visible:ring-ring";

export function TypographyQuickControl({ itemKey }: { itemKey?: string }) {
  const [open, setOpen] = useState(false);
  const observedApplied = useAppliedTypography();
  const [openedApplied, setOpenedApplied] = useState(observedApplied);
  const applied = open ? openedApplied : observedApplied;
  const { setTypography } = useTypographySelection();

  const changeProfile = (profile: TypographyProfileId) => {
    const next = {
      typographyProfile: profile,
      fontScalePercent: applied.scalePercent,
    };
    setOpenedApplied({
      profile: next.typographyProfile,
      scalePercent: next.fontScalePercent,
    });
    setTypography(next);
    setOpen(false);
  };

  const changeScale = (delta: number) => {
    const next = {
      typographyProfile: applied.profile,
      fontScalePercent: stepFontScalePercent(applied.scalePercent, delta),
    };
    setOpenedApplied({
      profile: next.typographyProfile,
      scalePercent: next.fontScalePercent,
    });
    setTypography(next);
  };

  return (
    <SidebarMenuItem className="min-w-0" data-footer-item={itemKey}>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpenedApplied(getAppliedTypography());
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton
            aria-label="Typography"
            aria-haspopup="dialog"
            aria-expanded={open}
            tooltip={{ children: "Typography", hidden: false, side: "top" }}
            className={cn(
              SIDEBAR_FOOTER_ACTION_CLASS,
              open &&
                "bg-sidebar-accent text-sidebar-accent-foreground [&>svg]:opacity-100",
            )}
          >
            <span aria-hidden="true" className="text-xs font-semibold">
              Aa
            </span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          mobileTitle="Typography"
          className="w-56 p-2"
        >
          <div role="group" aria-label="Typography profile" className="grid gap-0.5">
            {typographyProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                role="menuitemradio"
                aria-checked={applied.profile === profile.id}
                className={cn(
                  PROFILE_OPTION_CLASS,
                  applied.profile === profile.id && "bg-secondary/60",
                )}
                onClick={() => changeProfile(profile.id)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {typographyProfileLabel(profile.id)}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {typographyProfileHint(profile.id)}
                  </span>
                </span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto shrink-0",
                    applied.profile !== profile.id && "opacity-0",
                  )}
                />
              </button>
            ))}
          </div>
          <div
            className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2"
            role="group"
            aria-label="Text size"
          >
            <Button
              variant="outline"
              size="sm"
              className={FONT_SCALE_STEPPER_BUTTON_CLASS}
              disabled={applied.scalePercent <= FONT_SCALE_MIN_PERCENT}
              aria-label="Decrease text size"
              onClick={() => changeScale(-1)}
            >
              <Icon name="ZoomOut" />
            </Button>
            <span
              className="min-w-10 text-center font-mono text-xs"
              aria-live="polite"
            >
              {applied.scalePercent}%
            </span>
            <Button
              variant="outline"
              size="sm"
              className={FONT_SCALE_STEPPER_BUTTON_CLASS}
              disabled={applied.scalePercent >= FONT_SCALE_MAX_PERCENT}
              aria-label="Increase text size"
              onClick={() => changeScale(1)}
            >
              <Icon name="Plus" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
