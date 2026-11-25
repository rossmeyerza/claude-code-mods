let count = 0
let choice = 'one'
let note = ''

function cellsOf(rows) {
  const cells = rows.flat().flatMap(([char, colour]) => [char.codePointAt(0), colour, 0x01000000])
  return new Uint8Array(Uint32Array.from(cells).buffer).toBase64()
}

function drawing(ui, surface) {
  if (surface === 'terminal') {
    return ui.Raster({ key: 'grid', columns: 8, rows: 3, cells: cellsOf([
      [0, 1, 2, 3, 4, 5, 6, 7].map(i => ['█', 0x224466 + i * 0x110a00]),
      [0, 1, 2, 3, 4, 5, 6, 7].map(i => ['●', 0x44aa88 + i * 0x080000]),
      [0, 1, 2, 3, 4, 5, 6, 7].map(i => ['◆', 0xcc8844 - i * 0x080400]),
    ]) })
  }
  return ui.Svg({ alt: 'Coloured bars and a circle', width: 220, height: 90,
    source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 90"><rect width="220" height="90" rx="10" fill="#172437"/><rect x="20" y="50" width="25" height="30" fill="#51bba0"/><rect x="55" y="30" width="25" height="50" fill="#e9b15b"/><rect x="90" y="12" width="25" height="68" fill="#e56b6f"/><circle cx="165" cy="45" r="28" fill="none" stroke="#89b4fa" stroke-width="8"/><path d="M145 47l14 14 28-32" fill="none" stroke="#51bba0" stroke-width="5"/></svg>' })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-gallery', description: 'Open the mod test pane' })
    const result = await next(e)
    await $.ui.open({ id: 'mod-gallery', title: 'Mod gallery', rows: 20, columns: 55, closeOnEscape: true })
    return result
  })
  on('command.run', { command: 'mod-gallery' }, async ($) => {
    await $.ui.open({ id: 'mod-gallery', title: 'Mod gallery', focus: true, closeOnEscape: true })
    return {}
  })
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== 'mod-gallery') return next(e)
    const ui = $.ui.resolve(e)
    const redraw = () => $.ui.invalidate('ui.render')
    return ui.Box({ flexDirection: 'column', children: [
      ui.Text({ bold: true, color: 'cyan', children: ['MOD INTERFACE GALLERY'] }),
      ui.Text({ dimColor: true, children: [`Surface: ${e.surface} | Placement: ${e.props.placement} | Width: ${e.props.bodyColumns}`] }),
      ui.Text({ children: ['Plain  ', ui.Text({ bold: true, children: ['bold'] }), '  ', ui.Text({ italic: true, children: ['italic'] }), '  ', ui.Text({ underline: true, children: ['underline'] })] }),
      ui.Text({ color: 'green', children: ['Green text  •  ▰▰▰▱▱  •  Unicode'] }),
      ui.Markdown({ text: '### Markdown\n**Bold**, `code`, and a list:\n- First item\n- Second item' }),
      ui.Code({ language: 'javascript', startLine: 1, source: "const surface = 'gallery'\nconsole.log(surface)" }),
      ui.Text({ bold: true, children: ['Drawing sample'] }),
      drawing(ui, e.surface),
      ui.Text({ children: [`Button count: ${count}  |  Note: ${note || '(empty)'}`] }),
      ui.Button({ key: 'add', label: 'Add one', hotkey: 'a', onPress: () => { count++; redraw() } }),
      ui.Input({ key: 'note', label: 'Note', placeholder: 'Type and press Enter', value: note, onSubmit: value => { note = value; redraw() } }),
      ui.Select({ key: 'choice', label: 'Choice', value: choice, options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], onSelect: value => { choice = value; redraw() } }),
      ui.Link({ href: 'https://code.claude.com/docs/en/plugins/mods/gallery', label: 'Mods gallery docs' }),
    ] })
  })
}
