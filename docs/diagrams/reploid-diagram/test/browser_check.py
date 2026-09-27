from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
 page.set_content((root/'index.html').read_text());page.wait_for_selector('[data-node="A"]')
 assert page.locator('[data-node]').count()==3
 assert page.get_by_role('tab').count()==8
 assert page.evaluate('window.diagramEditor.getRenderer()')=='svg'
 page.screenshot(path=str(root/'test/ecosystem-preview.png'))
 page.get_by_role('tab',name='Interfaces',exact=True).click()
 page.wait_for_timeout(150)
 assert page.locator('[data-edge]').count()==6
 page.screenshot(path=str(root/'test/interfaces-preview.png'))
 page.get_by_role('tab',name='Stream',exact=True).click();page.wait_for_timeout(150)
 assert page.locator('[data-edge]').count()==10
 page.screenshot(path=str(root/'test/sequence-preview.png'))
 for name, edge_count in [('Improve',8),('Placement',3),('Cancel',10),('Recover',7),('Adopt',3)]:
  page.get_by_role('tab',name=name,exact=True).click();page.wait_for_timeout(100)
  assert page.locator('[data-edge]').count()==edge_count
 page.get_by_role('tab',name='Products',exact=True).click();page.wait_for_timeout(100)
 page.locator('[data-edge="A-B"]').click()
 assert page.locator('#details').is_visible()
 page.get_by_role('button',name='Interface contract',exact=True).click()
 assert page.get_by_role('tab',name='Interfaces',exact=True).get_attribute('aria-selected')=='true'
 page.get_by_role('button',name='Edit JSON',exact=True).click()
 page.locator('#json-editor').fill('{"format":"wrong"}')
 page.get_by_role('button',name='Validate and render',exact=True).click()
 assert 'Expected format' in page.locator('#editor-error').inner_text()
 page.locator('#editor-cancel').click()
 page.get_by_role('tab',name='Products',exact=True).click();page.wait_for_timeout(100)
 old=page.evaluate('window.diagramEditor.getJSON().views[0].nodes[0].x')
 box=page.locator('[data-node="A"]').bounding_box();x,y=box['x']+40,box['y']+40
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+50,y+20,steps=5);page.mouse.up()
 new=page.evaluate('window.diagramEditor.getJSON().views[0].nodes[0].x');assert new>old
 with page.expect_download() as d:
  page.get_by_role('button',name='Export JSON',exact=True).click()
 assert d.value.suggested_filename=='diagram.json'
 with page.expect_download() as d:
  page.get_by_role('button',name='Export SVG',exact=True).click()
 assert d.value.suggested_filename=='ecosystem.svg'
 page.set_viewport_size({'width':430,'height':932});page.get_by_role('button',name='Fit',exact=True).click();page.wait_for_timeout(100)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 page.screenshot(path=str(root/'test/mobile-preview.png'))
 assert errors==[],errors
 browser.close()
print('PASS: offline SVG; all 8 views; inspector links; JSON validation; dragging; JSON/SVG export; mobile width; no uncaught page errors.')
