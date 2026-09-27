# Dependencies and asset provenance

This is a private development snapshot. No project-wide open-source license has been selected. Third-party components retain their own licenses; this note does not replace their license texts or grant rights to third-party music.

## Software

Exact versions and dependency sources are recorded in `pnpm-lock.yaml` and the workspace manifests. Important components include Audiotool Nexus, React, Vite, Fastify, PostgreSQL, Deep Agents, LangGraph/LangChain, the OpenAI and Google clients, Base UI, shadcn/ui, Tailwind, Lucide and Motion. Nexus 0.0.17 declares the MIT license in its installed package metadata. Review each dependency's distributed notices when preparing a redistributed build.

The locally owned UI wrappers originated from the shadcn/Base UI component workflow. Their provenance, customizations and upgrade checks are recorded in [the design system](docs/design-system.md). Geist is distributed through `@fontsource-variable/geist`; its package includes the upstream font license. Georgia is referenced as a system font, not bundled.

## Images, sounds and examples

- The Pocket Producer mark is an SVG interpretation of the logo reference supplied for this project. The wordmark is live text. No claim of trademark registration is made.
- Hero and section artwork is composed from local CSS/SVG shapes.
- README screenshots are captures of the actual application using isolated deterministic test data, not images of a live user's session or claims of model-generated musical quality.
- Test audio is synthesized by repository scripts. No commercial track or external sample pack is bundled for the demo.
- Original sound recipes and musical examples describe editable musical construction; they are not recordings or guarantees of acoustic quality.
- User uploads and Audiotool library resources are not licensed by this repository. Users must have the necessary rights for their use; resource discovery or copying is not a rights determination.

Historical handoff/design references are retained as project documentation. Before changing repository visibility or distributing a release, review those references, choose the project's license, and check the applicable submission rules separately.
