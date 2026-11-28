# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Path & ID Hardening**: Document IDs (`{unitId}`, `{noteId}`) must be valid alphanumeric/hyphen/underscore strings up to 128 chars (`^[a-zA-Z0-9_\-]+$`).
2. **Public Transparency for Emergency Shift Rosters**: Per the product brief ("özellikle tablo üzerinde verileri herkes görebilecek ve mesela bu sistem kurum bazlı olacak örneğin polisler kendi vardiyalarini görecek çağrı alıcılar kendi vardiyalarini görecek"), `/units/{unitId}` and `/units/{unitId}/rosterNotes/{noteId}` allow public read (`get` and `list` bounded by `resource.data.numGroups >= 2` / `resource.data.unitId == unitId`) without exposing any PII (no email, phone, or home address fields are allowed in the schema).
3. **Strict Verified Bureau Admin Write Gate**: Creating or updating an `InstitutionUnit` or `UnitRosterNote` requires an authenticated user with `request.auth.token.email_verified == true`.
4. **Ownership & Bureau Admin Authorization**:
   - On `create` of `/units/{unitId}`: `incoming().ownerUid == request.auth.uid` and `request.auth.uid in incoming().adminUids`.
   - On `update` of `/units/{unitId}`: Only the unit owner (`existing().ownerUid == request.auth.uid`), an authorized bureau admin (`request.auth.uid in existing().adminUids`), or a global system admin (`isAdmin()`) may update the unit, and `ownerUid` + `createdAt` must remain immutable.
   - On `create`/`update`/`delete` of `/units/{unitId}/rosterNotes/{noteId}`: The parent `/units/{unitId}` document MUST exist (Master Gate via `get()`) and the requester must be the parent unit's `ownerUid`, in the parent unit's `adminUids`, or `isAdmin()`.
5. **Temporal Integrity**: `createdAt == request.time` on `create`, and `updatedAt == request.time` on both `create` and `update`.
6. **Total Array & String Size Guarding**: All strings have explicit `.size()` bounds; `groupNames`, `groupMembers`, and `adminUids` arrays are strictly bounded (`<= 10`).

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write Attack**: Attempt to create `/units/manisa-112` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof Attack**: Attempt to create `/units/manisa-112` with `email_verified: false` (even matching admin email) -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Unit Create**: Authenticated user `uid_attacker` sets `ownerUid: "uid_victim"` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Unit Create**: Payload includes extra key `"isSuperVerified": true` -> `PERMISSION_DENIED` via `hasOnly()`.
5. **Resource Poisoning (Oversized String)**: `announcement` string exceeds 400 characters -> `PERMISSION_DENIED`.
6. **Array Overflow Attack**: `groupMembers` array has 15 items (`> 10` limit) -> `PERMISSION_DENIED`.
7. **Unauthorized Bureau Update**: Authenticated user `uid_random_worker` attempts to update `/units/manisa-112` owned by `uid_admin` -> `PERMISSION_DENIED`.
8. **Immutable Field Tampering (`ownerUid` / `createdAt`)**: Admin attempts to mutate `ownerUid` or `createdAt` during an update -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Admin sends a forged past/future `updatedAt` timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Orphaned Subcollection Write (Master Gate Bypass)**: Admin attempts to create `/units/nonexistent_unit/rosterNotes/note_1` where parent `/units/nonexistent_unit` does not exist -> `PERMISSION_DENIED`.
11. **Cross-Unit Subcollection Spoofing**: Payload in `/units/unit_A/rosterNotes/note_1` sets `unitId: "unit_B"` -> `PERMISSION_DENIED`.
12. **Value Poisoning on Update**: Admin updates whitelisted key `numGroups` with a string `"five"` instead of an integer `2..10` -> `PERMISSION_DENIED` because `isValidInstitutionUnit(incoming())` wraps the update block.
13. **Cross-User Profile Read/Write (`UserCloudProfile`)**: Authenticated user `uid_attacker` attempts to read or overwrite `/userProfiles/uid_victim` -> `PERMISSION_DENIED` (`request.auth.uid == userId` & `allow list: if false`).
14. **Unauthorized Table Customization Overwrite (`UnitTableMeta`)**: Non-admin worker attempts to write `/units/unit_A/tableMeta/style` or inject > 500 cell highlight keys -> `PERMISSION_DENIED` (`isParentUnitBureauAdmin(unitId)` & `cellHighlights.size() <= 500`).

