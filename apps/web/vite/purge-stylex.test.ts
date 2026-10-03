import { describe, expect, it } from 'vitest'
import { purgeCss } from './purge-stylex'

const used = new Set(['xused1', 'xvars1'])

describe('purgeCss', () => {
  it('cuts only rules made of unused StyleX classes and keeps every other byte', () => {
    const css = [
      '.xused1{display:flex}',
      '.xdead01{display:block}',
      '.xdead02.xdead02:hover{color:red}',
      ':root,.xvars1{--a:1}',
      ':root,.xdead03{--b:2}',
      '.lg\\:grid{display:grid}',
      '[dir=rtl] .xdead04{margin:0}',
      '@media (min-width:1px){.xdead05{gap:0}.xused1:focus-visible{outline:0}}',
      '@media (hover:hover){.xdead06{opacity:1}}',
      '@layer utilities{.p-4{padding:1rem}.xdead07{padding:0}}',
      '@keyframes spin{0%{transform:none}to{transform:rotate(1turn)}}',
      '@property --dp-angle{syntax:"<angle>";inherits:false;initial-value:0deg}',
      '.a{content:"}{"}',
      '.xdead08,.xused1{top:0}',
    ].join('')
    expect(purgeCss(css, used)).toBe(
      [
        '.xused1{display:flex}',
        ':root,.xvars1{--a:1}',
        ':root,.xdead03{--b:2}',
        '.lg\\:grid{display:grid}',
        '[dir=rtl] .xdead04{margin:0}',
        '@media (min-width:1px){.xused1:focus-visible{outline:0}}',
        '@layer utilities{.p-4{padding:1rem}}',
        '@keyframes spin{0%{transform:none}to{transform:rotate(1turn)}}',
        '@property --dp-angle{syntax:"<angle>";inherits:false;initial-value:0deg}',
        '.a{content:"}{"}',
        '.xdead08,.xused1{top:0}',
      ].join(''),
    )
  })

  it('passes statement at-rules through', () => {
    expect(purgeCss('@layer theme,base;@import "x.css";.xdead01{a:b}.k{c:d}', used)).toBe('@layer theme,base;@import "x.css";.k{c:d}')
  })
})
