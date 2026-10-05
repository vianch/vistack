import { fit } from '../lib/format'
import { ICONS, THEMES, paletteOf } from '../lib/theme'
import { Empty, Section, glyph } from './parts'

import type { RenderElement } from 'claude-code'
import type { RealmSource } from '../lib/realm'
import type { Palette } from '../lib/theme'
import type { Kit } from './parts'
import type { DeckIcons, DeckPlacement, DeckSettings } from '../../types'

export type SettingsData = {
  settings: DeckSettings
  about: {
    project: string
    branch: string
    remote: string
    realm: string
    realmSource: RealmSource
    sessionId: string
    version: string
  }
}

export type SettingsActions = { set: (patch: Partial<DeckSettings>) => void; reset: () => void }

const PLACEMENT_LABEL: Readonly<Record<DeckPlacement, string>> = {
  bottom: 'Bottom: a band above the prompt',
  hidden: 'Hidden: /deck brings it back',
  right: 'Right: the docked pane (inline above the prompt outside fullscreen)',
}

const ICON_LABEL: Readonly<Record<DeckIcons, string>> = { ascii: 'ASCII', emoji: 'Emoji', unicode: 'Unicode' }

const SWATCHES: readonly Exclude<keyof Palette, 'label' | 'ramp'>[] = [
  'accent',
  'accent2',
  'user',
  'coordinator',
  'advisor',
  'agent',
  'model',
  'tool',
  'cost',
  'good',
  'warn',
  'bad',
  'muted',
]

export const settingsTab = (kit: Kit, data: SettingsData, actions: SettingsActions, columns: number): RenderElement => {
  const { Box, Button, Input, Select, Text, theme } = kit
  const { settings, about } = data
  const palette = paletteOf(settings.theme)

  return (
    <Box flexDirection="column">
      {Section(kit, `${glyph(kit, 'place')}Placement`, columns)}
      <Select
        key="set-placement"
        label={`${kit.icon.place} Where `}
        value={settings.placement}
        options={(['right', 'bottom', 'hidden'] as const).map(value => ({ label: PLACEMENT_LABEL[value], value }))}
        onSelect={value => actions.set({ placement: value === 'bottom' || value === 'hidden' ? value : 'right' })}
      />
      <Text dimColor>
        {fit('Top and left placement are not available: Claude Code docks a mod’s pane on the right or above the prompt.', columns * 2)}
      </Text>
      {Section(kit, `${glyph(kit, 'theme')}Look`, columns)}
      <Select
        key="set-theme"
        label={`${kit.icon.theme} Theme `}
        value={settings.theme}
        options={Object.entries(THEMES).map(([value, one]) => ({ label: one.label, value }))}
        onSelect={value => actions.set({ theme: value })}
      />
      <Select
        key="set-icons"
        label={`${kit.icon.spark} Icons `}
        value={settings.icons}
        options={(['emoji', 'unicode', 'ascii'] as const).map(value => ({
          label: `${ICON_LABEL[value]} ${ICONS[value].advisor} ${ICONS[value].coordinator} ${ICONS[value].builder}`,
          value,
        }))}
        onSelect={value => actions.set({ icons: value === 'unicode' || value === 'ascii' ? value : 'emoji' })}
      />
      <Box flexDirection="row" columnGap={2}>
        <Button
          key="set-animated"
          label={settings.isAnimated ? 'Animations: on' : 'Animations: off'}
          onPress={() => actions.set({ isAnimated: !settings.isAnimated })}
        />
        <Button key="set-reset" plain label="Reset to defaults" onPress={() => actions.reset()} />
      </Box>
      {Section(kit, `${glyph(kit, 'branch')}Git realm`, columns)}
      <Input
        key="set-realm"
        label="Git realm"
        placeholder="github.com/<org>"
        value={settings.realm}
        submitLabel="save"
        onSubmit={value => actions.set({ realm: value.trim() })}
      />
      <Text dimColor>
        {fit('The host and owner the deck may run gh and lazygit against: Open PRs lists your PRs in its repositories.', columns * 2)}
      </Text>
      <Text dimColor>Saved for every session ($.store), never in a settings file.</Text>
      {Section(kit, `Theme preview · ${palette.label}`, columns)}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={columns}>
        {SWATCHES.map(name => (
          <Text key={`swatch-${name}`}>
            <Text color={palette[name]}>██</Text>
            <Text dimColor> {name}</Text>
          </Text>
        ))}
      </Box>
      <Text>
        {palette.ramp.map((color, index) => (
          <Text key={`ramp-${index}`} color={color}>
            ████
          </Text>
        ))}
        <Text dimColor> chart ramp</Text>
      </Text>
      {Section(kit, `${glyph(kit, 'idea')}About`, columns)}
      {[
        ['project', about.project],
        ['branch', about.branch],
        ['remote', about.remote],
        ['realm', about.realm === '' ? `unset (${about.realmSource})` : `${about.realm} (${about.realmSource})`],
        ['session', about.sessionId],
        ['viStack', about.version],
      ].map(([label, value]) => (
        <Box key={`about-${label}`} width={columns}>
          <Text color={theme.muted}>{`${label ?? ''}`.padEnd(9)}</Text>
          <Text>{fit(value === undefined || value === '' ? '-' : value, Math.max(4, columns - 9))}</Text>
        </Box>
      ))}
      {about.version === '' && Empty(kit, 'Version is read from .claude-plugin/plugin.json when the session starts.')}
    </Box>
  )
}
