# Page snapshot

```yaml
- main [ref=e3]:
  - navigation "Reploid":
    - button "Toggle threads" [ref=e4] [cursor=pointer]:
      - generic [ref=e5]:
        - generic [ref=e6]: "7"
        - superscript [ref=e7]: "7"
    - group [ref=e9]:
      - generic "Settings" [ref=e10] [cursor=pointer]:
        - generic [ref=e11]:
          - generic [ref=e12]: "7"
          - superscript [ref=e13]: "7"
  - region "Conversation workspace" [ref=e15]:
    - region "Current conversation" [ref=e16]:
      - generic [ref=e17]:
        - button "Inspect network" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
        - group [ref=e24]:
          - generic "Conversation actions" [ref=e25] [cursor=pointer]:
            - img [ref=e26]
          - option "16" [selected]
          - option "32"
          - option "64"
      - log "Messages" [ref=e31]
      - generic [ref=e33]:
        - generic [ref=e34]: Message
        - generic [ref=e35]:
          - textbox "Message" [ref=e36]:
            - /placeholder: Ask a question…
          - generic "Attach files" [ref=e37] [cursor=pointer]:
            - img [ref=e38]
            - generic [ref=e40]: Attach files
            - button "Attach files" [ref=e41]
          - button "Send" [disabled] [ref=e43]:
            - img [ref=e44]
        - button "Retry connection" [ref=e47] [cursor=pointer]
  - text: ●
```