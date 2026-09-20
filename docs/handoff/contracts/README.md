# Illustrative contracts

[composition.example.json](composition.example.json) is an eight-bar, 20-second **schema illustration/test input**, not a finished musical arrangement. Its sparse events make validation easy to inspect. Asset paths, IDs and hashes are placeholders; no corresponding audio or database exists in this package. Initial product outputs are proposed at 30–60 seconds, while technical fixtures can be shorter.

[revision-patch.example.json](revision-patch.example.json) demonstrates a section-scoped drum change while protecting the melody. Its zero hash is a placeholder, not a verified revision hash. The package validator checks timing, references, protection/scope declarations, and applies the illustrated operation to confirm outside-scope/protected data remain unchanged. It does not run a production renderer, prove a full JSON Schema or test Nexus compatibility.

The implementation agent should turn the semantic requirements in [domain/API contracts](../05-Domain-and-API-contracts.md) into one authoritative runtime schema library and generate types/OpenAPI from that. Examples can evolve alongside it. Keep stored schema versions and explicit migrations; don't turn these explanatory JSON files into accidental permanent API commitments.
