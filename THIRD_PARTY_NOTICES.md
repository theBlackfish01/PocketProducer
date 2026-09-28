# Dependencies and asset provenance

Original Pocket Producer code and documentation are licensed under [Apache-2.0](LICENSE). Third-party components retain their own licenses; this note does not replace their license texts or grant rights to third-party music or trademarks. Repository visibility remains private until the owner changes it explicitly.

## Software

Exact versions and dependency sources are recorded in `pnpm-lock.yaml` and the workspace manifests. Important components include Audiotool Nexus, React, Vite, Fastify, PostgreSQL, Deep Agents, LangGraph/LangChain, the OpenAI and Google clients, Base UI, shadcn/ui, Tailwind, Lucide and Motion. Nexus 0.0.17 declares the MIT license in its installed package metadata. Review each dependency's distributed notices when preparing a redistributed build.

The locally owned UI wrappers originated from the shadcn/Base UI component workflow. The [shadcn MIT notice](docs/licenses/shadcn-MIT.txt) is retained for that upstream material. Their provenance, customizations and upgrade checks are recorded in [the design system](docs/design-system.md). Geist is distributed through `@fontsource-variable/geist`; its package includes the upstream font license. Georgia is referenced as a system font, not bundled. The retained React/Vite starter logos are upstream assets, not original Pocket Producer artwork.

## Images, sounds and examples

- The Pocket Producer mark is an SVG interpretation of the logo reference supplied for this project. The wordmark is live text. No claim of trademark registration is made.
- Hero and section artwork is composed from local CSS/SVG shapes.
- README screenshots are captures of the actual application using isolated deterministic test data, not images of a live user's session or claims of model-generated musical quality.
- Test audio is synthesized by repository scripts. No commercial track or external sample pack is bundled for the demo.
- Original sound recipes and musical examples describe editable musical construction; they are not recordings or guarantees of acoustic quality.
- User uploads and Audiotool library resources are not licensed by this repository. Users must have the necessary rights for their use; resource discovery or copying is not a rights determination.

## Handoff provenance review

The historical handoff and its ZIP are retained as project documentation. The selected Listening Room mockup is recorded as AI-generated for this project, with its generation prompt in `docs/handoff/design/mockup-generation-prompt.md`. The reference register links to external software/documentation and inspiration; those links do not license their code, artwork or brands. No commercial recording or external sample pack is bundled in the reviewed handoff.

The package validator verified its 35-file manifest, local links, image dimensions and contrast checks on 2026-09-28. This supports package integrity, not independent legal clearance of every reference. User-supplied logo provenance is recorded above; third-party resources and future uploads remain subject to their own rights. Check applicable submission rules separately before release.
