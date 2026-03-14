import { redirect } from "next/navigation";

/**
 * The old PR creation wizard has been replaced by the in-context staging cart.
 * Users stage changes from the browse view and submit from the review drawer.
 * Redirect any old links to the browse page.
 */
export default function PRCreatePage() {
    redirect("/browse");
}
