import { apiFetch } from "@/lib/api-client";
import { type Operation } from "@/lib/staging-store";
import { toast } from "sonner";

/** Generate a sensible auto-title from one or multiple operations. */
export function autoTitle(ops: Operation[]): string {
    if (ops.length === 0) return "Brouillon de contribution";
    if (ops.length > 1) {
        // e.g. "Deleted 3 items", "Moved 5 items"
        const types = new Set(ops.map((o) => o.op));
        if (types.size === 1) {
            const type = Array.from(types)[0];
            if (type.startsWith("delete_"))
                return `Suppression de ${ops.length} éléments`;
            if (type === "move_item")
                return `Déplacement de ${ops.length} éléments`;
        }
        return `Modification de ${ops.length} éléments`;
    }

    const op = ops[0];
    switch (op.op) {
        case "create_material":
            return op.title ? `Ajout : « ${op.title} »` : "Ajout d'un document";
        case "edit_material":
            return op.title
                ? `Modification : « ${op.title} »`
                : "Modification d'un document";
        case "delete_material":
            return "Suppression d'un document";
        case "create_directory":
            return op.name ? `Nouveau dossier : « ${op.name} »` : "Création d'un dossier";
        case "edit_directory":
            return op.name ? `Renommage : « ${op.name} »` : "Modification d'un dossier";
        case "delete_directory":
            return "Suppression d'un dossier";
        case "move_item":
            return `Déplacement d'un ${
                op.target_type === "directory" ? "dossier" : "document"
            }`;
    }
}

/**
 * Post operations directly as a PR without putting them in the staging store.
 * Returns the PR ID if successful, null otherwise.
 */
export async function submitDirectOperations(
    ops: Operation[],
    manualTitle?: string,
    manualDescription?: string | null
): Promise<{ id: string; status: string } | null> {
    if (ops.length === 0) return null;

    const title = manualTitle || autoTitle(ops);

    const promise = apiFetch<{ id: string; status: string }>(
        "/pull-requests",
        {
            method: "POST",
            body: JSON.stringify({
                title: title.trim(),
                description: manualDescription ?? null,
                operations: ops,
            }),
        }
    );

    toast.promise(promise, {
        loading: "Création de la contribution...",
        success: (result) => {
            if (result.status === "approved") {
                return "Modifications publiées immédiatement";
            }
            return "Contribution envoyée — en attente de validation";
        },
        error: (err) => (err instanceof Error ? err.message : "Échec de l'envoi"),
    });

    try {
        const result = await promise;
        return result;
    } catch {
        return null;
    }
}
