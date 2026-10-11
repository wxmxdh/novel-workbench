<script setup lang="ts">
import WindowFrame from "./components/WindowFrame.vue";
import { defineAsyncComponent } from "vue";

const WorkspaceShell = defineAsyncComponent(
  () => import("./WorkspaceShell.vue")
);
</script>

<template>
  <WindowFrame><WorkspaceShell /></WindowFrame>
</template>
