# Agent Personas

This document explains the concept of **Personas** for contributors. Personas are the primary way users interact with Reploid, providing a simplified, goal-oriented starting point.

## What is a Persona?

A Persona is a pre-packaged agent configuration. It bundles a specific set of **Upgrades** (capabilities) and **Blueprints** (knowledge) into a single, user-selectable option. This abstracts away the technical details of the underlying modules.

## How are Personas Defined?

Personas are defined as an array of objects in `config.json` under the `personas` key. This file is the single source of truth for what personas are available and what capabilities they have.

Each persona object has:
- `id`: A unique identifier.
- `name`: A user-friendly name displayed on the UI.
- `description`: A simple explanation of what the persona is good for.
- `upgrades`: A list of upgrade IDs (from the `upgrades` array in `config.json`) that this persona will have.
- `blueprints`: A list of blueprint IDs (from the `blueprints` array in `config.json`) to load into the agent's knowledge base.

## Why Use Personas?

- **Simplicity:** Users don't need to understand the complex web of upgrades and blueprints. They can just pick an agent that sounds right for their task.
- **Consistency:** Ensures that agents created for a specific purpose always have the correct set of tools and knowledge.
- **Extensibility:** To add a new "type" of agent, a contributor simply needs to add a new persona definition to `config.json` and write a short description here.

## The "Advanced Mode"

For developers and researchers, an "Advanced Mode" toggle is available on the onboarding screen. This bypasses the persona selection and reveals the original UI for manually selecting individual upgrades and blueprints, providing full flexibility for experimentation.
