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
          - generic [ref=e24]: 0 peers
        - group [ref=e25]:
          - generic "Conversation actions" [ref=e26] [cursor=pointer]:
            - img [ref=e27]
          - option "16" [selected]
          - option "32"
          - option "64"
      - log "Messages" [ref=e32]
      - generic [ref=e34]:
        - generic [ref=e35]: Message
        - generic [ref=e36]:
          - textbox "Message" [ref=e37]:
            - /placeholder: Ask a question…
          - generic "Attach files" [ref=e38] [cursor=pointer]:
            - img [ref=e39]
            - generic [ref=e41]: Attach files
            - button "Attach files" [ref=e42]
          - button "Send" [disabled] [ref=e44]:
            - img [ref=e45]
```