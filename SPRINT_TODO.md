# REPLOID - Remaining Sprint Tasks

## Tasks

- [ ] Record 60-second demo video
  - Screen record WebLLM demo in Chrome 113+
  - Show: model loading → tool creation → self-improvement
  - Save as `/home/clocksmith/deco/reploid/assets/demo.mp4`
  - Keep it simple, authentic, and visual

- [ ] Add hero landing page to index.html
  - Implement hero section HTML/CSS from Day 1-2 template
  - Add "Try It Now" button (auto-starts WebLLM demo)
  - Add "See Example" button (loads pre-built example)
  - Embed demo video when ready
  - Hide boot container by default

- [ ] Test WebLLM demo reliability
  - Test in Chrome 113+ and Edge 113+
  - Run example 5-10 times, verify >80% success rate
  - Check model loading UX (progress indicators clear)
  - Verify error messages are helpful
  - Test cached vs first-time load experience

- [ ] Share publicly
  - Post to Twitter/X with demo video
  - Submit to Hacker News (Show HN: REPLOID - Browser AI that modifies its own code)
  - Post to r/MachineLearning and r/LocalLLaMA
  - Include link: https://reploid.firebaseapp.com

- [ ] Add URL parameter demo mode
  - Support `?demo` URL parameter for auto-start
  - Auto-configure WebLLM when `?demo` detected
  - Pre-load example prompt
  - Test: `https://reploid.firebaseapp.com?demo`

- [ ] Polish example prompts
  - Verify time-button example works with Phi-3.5-mini
  - Simplify prompt if success rate <80%
  - Add helpful loading messages

- [ ] Update README with demo link
  - Add demo video link/embed
  - Update "Try It Now" section with live URL
  - Add browser requirements prominently

---

**Deploy after each major change:**
```bash
cd /home/clocksmith/deco/reploid
firebase deploy --only hosting
```

**Estimated Total Time: 3-4 hours**
