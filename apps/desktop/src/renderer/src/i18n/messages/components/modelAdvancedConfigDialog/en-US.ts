export default {
  thisEnvironmentCannotReadTheModelSActualRequest:
    "This environment cannot read the model's actual request capacity.",
  couldNotReadTheModelSActualRequestCapacity:
    "Could not read the model's actual request capacity.",
  enterAContextLengthBetweenValueAndValue:
    "Enter a context length between {arg0} and {arg1}.",
  enterAMaximumOutputLengthBetweenValueAndValue:
    "Enter a maximum output length between {arg0} and {arg1}.",
  maximumOutputLengthCannotExceedContextLength:
    "Maximum output length cannot exceed context length.",
  leaveInputAndRuntimeCapacity:
    "Context must exceed maximum output by at least 8,192 tokens: 4,096 for runtime overhead and at least 4,096 for input.",
  capacityFieldsAreDifferent:
    "These are different limits: context is the total space for input and output; maximum output caps one reply. They are not two memory pools to add together. The workbench reserves runtime space and keeps at least 4,096 tokens for input.",
  savedCapacityNeedsCorrection:
    "This saved capacity combination leaves too little room for input. Adjust it and save; the existing setting remains readable.",
  modelSettings: "Model settings",
  advancedSettings: "Advanced settings",
  generateASubagentDraftFor: "Generate a subagent draft for “",
  defaultsMatchTheCurrentRequestSavedChangesApplyTo:
    "”. Defaults match the current request; saved changes apply to future requests.",
  contextLength: "Context length",
  readingActualRequestCapacity: "Reading actual request capacity…",
  totalTokensPerRequestIncludingInputAndOutput:
    "Total tokens per request, including input and output.",
  maximumOutputLength: "Maximum output length",
  maximumTokensGeneratedInASingleReply:
    "Maximum tokens generated in a single reply.",
  cancel: "Cancel",
  saving: "Saving…",
  save: "Save",
  setRequestCapacityForDefaultsMatchTheMessage:
    "Set request capacity for “{arg0}”. Defaults match the current request; saved changes apply to future requests."
};
