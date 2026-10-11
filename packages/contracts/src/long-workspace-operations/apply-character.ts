import type { LongWorkspaceOperation } from "./operation-schema";
import type { MutationState } from "./state";

import { deleteCharacter } from "./cascade";
import {
  addFileCreateIntent,
  assertExactOrder,
  assertNewEntityId,
  ensureFilesAvailable,
  findEntityIndex,
  insertBeforeId,
  markCreated,
  markDeleted,
  markUpdated,
  operationError,
  registerProvisionalId,
  updateOrdersById,
  nextOrder
} from "./state";

export function applyCharacterOperation(
  state: MutationState,
  operation: LongWorkspaceOperation
): void {
  const workspace = state.draft;
  switch (operation.type) {
    case "characterType.create": {
      assertNewEntityId(
        workspace.characterTypes,
        operation.characterType.id,
        "Character type"
      );
      const characterType = structuredClone(operation.characterType);
      characterType.order = nextOrder(
        workspace.characterTypes.map(({ order }) => order)
      );
      workspace.characterTypes.push(characterType);
      markCreated(state, operation.characterType.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.characterType.id
      );
      break;
    }
    case "characterType.update": {
      const characterType =
        workspace.characterTypes[
          findEntityIndex(
            workspace.characterTypes,
            operation.id,
            "Character type"
          )
        ]!;
      Object.assign(characterType, operation.patch);
      markUpdated(state, characterType.id);
      break;
    }
    case "characterType.delete": {
      const typeIndex = findEntityIndex(
        workspace.characterTypes,
        operation.id,
        "Character type"
      );
      const affected = workspace.characters.filter(
        ({ group }) => group === operation.id
      );
      if (affected.length > 0) {
        const targetId = operation.moveCharactersToTypeId;
        if (targetId === operation.id) {
          operationError(
            "invalid_reference",
            "A deleted character type cannot migrate characters to itself."
          );
        }
        if (targetId === undefined) {
          affected.forEach((character) => deleteCharacter(state, character.id));
        } else {
          findEntityIndex(workspace.characterTypes, targetId, "Character type");
          const nextOrder = workspace.characters.filter(
            ({ group }) => group === targetId
          ).length;
          affected
            .sort((left, right) => left.order - right.order)
            .forEach((character, index) => {
              character.group = targetId;
              character.order = nextOrder + index + 1;
              markUpdated(state, character.id);
            });
        }
      } else if (
        operation.moveCharactersToTypeId !== undefined &&
        operation.moveCharactersToTypeId === operation.id
      ) {
        operationError(
          "invalid_reference",
          "A deleted character type cannot migrate characters to itself."
        );
      } else if (operation.moveCharactersToTypeId !== undefined) {
        findEntityIndex(
          workspace.characterTypes,
          operation.moveCharactersToTypeId,
          "Character type"
        );
      }
      workspace.characterTypes.splice(typeIndex, 1);
      markDeleted(state, operation.id);
      break;
    }
    case "characterType.reorder": {
      assertExactOrder(
        workspace.characterTypes.map(({ id }) => id),
        operation.orderedIds,
        "Character types"
      );
      updateOrdersById(
        workspace.characterTypes,
        operation.orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      break;
    }

    case "character.create": {
      findEntityIndex(
        workspace.characterTypes,
        operation.character.group,
        "Character type"
      );
      assertNewEntityId(
        workspace.characters,
        operation.character.id,
        "Character"
      );
      if (operation.files.characterId !== operation.character.id) {
        operationError(
          "invalid_reference",
          "Character files must reference the created character."
        );
      }
      const files = [
        operation.files.coreProfile,
        operation.files.relationships
      ];
      ensureFilesAvailable(state, files);
      const character = structuredClone(operation.character);
      character.order = nextOrder(
        workspace.characters
          .filter((candidate) => candidate.group === character.group)
          .map(({ order }) => order)
      );
      workspace.characters.push(character);
      workspace.characterFiles.push(structuredClone(operation.files));
      files.forEach((file) =>
        addFileCreateIntent(
          state,
          file,
          `Create character ${operation.character.id}`
        )
      );
      markCreated(state, operation.character.id);
      registerProvisionalId(
        state,
        operation.provisionalId,
        operation.character.id
      );
      break;
    }
    case "character.update": {
      const character =
        workspace.characters[
          findEntityIndex(workspace.characters, operation.id, "Character")
        ]!;
      Object.assign(character, operation.patch);
      markUpdated(state, character.id);
      break;
    }
    case "character.delete": {
      deleteCharacter(state, operation.id);
      break;
    }
    case "character.move": {
      findEntityIndex(
        workspace.characterTypes,
        operation.toGroup,
        "Character type"
      );
      const character =
        workspace.characters[
          findEntityIndex(workspace.characters, operation.id, "Character")
        ]!;
      character.group = operation.toGroup;
      const target = workspace.characters
        .filter(({ group }) => group === operation.toGroup)
        .sort((left, right) => left.order - right.order);
      const orderedIds = insertBeforeId(
        target.map(({ id }) => id),
        character.id,
        operation.beforeCharacterId,
        "Character move"
      );
      updateOrdersById(
        target,
        orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      markUpdated(state, character.id);
      break;
    }
    case "character.reorder": {
      findEntityIndex(
        workspace.characterTypes,
        operation.group,
        "Character type"
      );
      const target = workspace.characters
        .filter(({ group }) => group === operation.group)
        .sort((left, right) => left.order - right.order);
      assertExactOrder(
        target.map(({ id }) => id),
        operation.orderedIds,
        `Character group ${operation.group}`
      );
      updateOrdersById(
        target,
        operation.orderedIds,
        (value, order) => {
          value.order = order;
        },
        state
      );
      break;
    }
    default:
      break;
  }
}
