# [DOPPLER](https://github.com/clocksmith/doppler)

**D**istributed **O**n-device **P**ipeline **P**rocessing **L**arge **E**mbedded **R**eploid

This directory is a namespace placeholder linking to the sibling project.

```
┌─────────────────────────────────┐
│           REPLOID               │  Browser-native AI agent
│  ./reploid/                     │  ← Actual code is here
└─────────────────────────────────┘
                ↓ uses
┌─────────────────────────────────┐
│           DOPPLER               │  WebGPU inference engine
│  github.com/clocksmith/doppler  │  for local inference
└─────────────────────────────────┘
```

## Structure

```
reploid/                          ← You are here (REPLOID repo)
├── README.md                     ← Root pointer
├── doppler/                      ← Namespace (this directory)
│   ├── README.md                 ← This file
│   └── reploid/                  ← Actual REPLOID package
│       ├── README.md             ← Full documentation
│       ├── package.json
│       └── ...
```

## Why This Structure?

DOPPLER and REPLOID reference each other in their names:

- **REPLOID** = Recursive Evolution Protocol Loop Orchestrating Inference **Doppler**
- **DOPPLER** = Distributed On-device Pipeline Processing Large Embedded **Reploid**

The mirrored directory structure reflects this relationship. Each repo contains a namespace for the other, creating symmetric navigation patterns for developers working on both projects.

## Links

- [REPLOID package](./reploid/) - The actual code in this repo
- [DOPPLER repo](https://github.com/clocksmith/doppler) - WebGPU inference engine
- [replo.id/r](https://replo.id/r) - REPLOID live demo
- [replo.id/d](https://replo.id/d) - DOPPLER live demo
