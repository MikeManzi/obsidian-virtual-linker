import IntervalTree from '@flatten-js/interval-tree';
import { LinkerPluginSettings } from 'main';
import { TFile } from 'obsidian';

export class VirtualMatch {
    private searchInput: HTMLInputElement | null;
    private virtualLinks: HTMLAnchorElement[];
    private originalTexts: Map<HTMLAnchorElement, string>;

    constructor(
        public id: number,
        public originText: string,
        public from: number,
        public to: number,
        public files: TFile[],
        public isAlias: boolean,
        public isSubWord: boolean,
        public settings: LinkerPluginSettings
    ) {
        this.searchInput = document.querySelector('.search-input-container.document-search-input input');
        const virtualLinksAnchors = Array.from(document.querySelectorAll('.internal-link.virtual-link-a'));
        this.virtualLinks = virtualLinksAnchors.filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
        this.originalTexts = new Map();
        this.virtualLinks.forEach((a) => {
            this.originalTexts.set(a, a.textContent ?? '');
        });

        // Run highlight initially
        this.highlightVirtualLinks();

        // Observe DOM changes to detect when the search input is displayed
        const observer = new MutationObserver(() => {
            const input = document.querySelector('.search-input-container.document-search-input input');
            if (input && input !== this.searchInput) {
                this.searchInput = input as HTMLInputElement;
                this.highlightVirtualLinks();
                this.searchInput.addEventListener('input', () => this.highlightVirtualLinks());
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('DOMContentLoaded', () => {
            if (this.searchInput) {
                // Run highlight when DOM is loaded
                this.highlightVirtualLinks();
                // Add listener for future changes
                this.searchInput.addEventListener('input', () => this.highlightVirtualLinks());
            }
        });
    }

    /////////////////////////////////////////////////
    // DOM methods
    /////////////////////////////////////////////////

    highlightVirtualLinks(): void {
        if (this.searchInput) {
            const query = this.searchInput.value;
            const regex = query ? new RegExp(`(${this.escapeRegex(query)})`, 'gi') : null;

            // Always get the latest set of virtual links
            const virtualLinksAnchors = Array.from(document.querySelectorAll('.internal-link.virtual-link-a'));
            this.virtualLinks = virtualLinksAnchors.filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);

            // Update originalTexts for any new links
            this.virtualLinks.forEach((a) => {
                if (!this.originalTexts.has(a)) {
                    this.originalTexts.set(a, a.textContent ?? '');
                }
            });

            this.virtualLinks.forEach((a) => {
                const originalText = this.originalTexts.get(a) ?? '';
                if (!query || !regex) {
                    a.innerHTML = originalText;
                } else {
                    a.innerHTML = originalText.replace(regex, '<span class="obsidian-search-match-highlight">$1</span>');
                }
            });
        }
    }

    escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    getCompleteLinkElement() {
        const span = this.getLinkRootSpan();
        const firstPath = this.files.length > 0 ? this.files[0].path : '';
        span.appendChild(this.getLinkAnchorElement(this.originText, firstPath));
        if (this.files.length > 1) {
            if (!this.isSubWord) {
                span.appendChild(this.getMultipleReferencesIndicatorSpan());
            }
            span.appendChild(this.getMultipleReferencesSpan());
        }

        if (!this.isSubWord || !this.settings.suppressSuffixForSubWords) {
            const icon = this.getIconSpan();
            if (icon) span.appendChild(icon);
        }
        return span;
    }

    getLinkAnchorElement(linkText: string, href: string) {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = linkText;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('from', this.from.toString());
        link.setAttribute('to', this.to.toString());
        link.setAttribute('origin-text', this.originText);
        link.classList.add('internal-link', 'virtual-link-a');
        return link;
    }

    getLinkRootSpan() {
        const span = document.createElement('span');
        span.classList.add('glossary-entry', 'virtual-link', 'virtual-link-span');
        if (this.settings.applyDefaultLinkStyling) {
            span.classList.add('virtual-link-default');
        }
        return span;
    }

    getMultipleReferencesSpan(files?: TFile[]) {
        const spanReferences = document.createElement('span');
        if (!this.settings.alwaysShowMultipleReferences) {
            spanReferences.classList.add('multiple-files-references');
        }

        files = files ?? this.files;

        files.forEach((file, index) => {
            if (index === 0) {
                const bracket = document.createElement('span');
                bracket.textContent = this.isSubWord ? '[' : ' [';
                spanReferences.appendChild(bracket);
            }

            let linkText = ` ${index + 1} `;
            if (index < files!.length - 1) {
                linkText += '|';
            }

            let linkHref = file.path;
            const link = this.getLinkAnchorElement(linkText, linkHref);
            spanReferences.appendChild(link);

            if (index == files!.length - 1) {
                const bracket = document.createElement('span');
                bracket.textContent = ']';
                spanReferences.appendChild(bracket);
            }
        });

        return spanReferences;
    }

    getMultipleReferencesIndicatorSpan() {
        const spanIndicator = document.createElement('span');
        spanIndicator.textContent = ' [...]';
        spanIndicator.classList.add('multiple-files-indicator');
        return spanIndicator;
    }

    getIconSpan() {
        const suffix = this.isAlias ? this.settings.virtualLinkAliasSuffix : this.settings.virtualLinkSuffix;
        if ((suffix?.length ?? 0) > 0) {
            let icon = document.createElement('sup');
            icon.textContent = suffix;
            icon.classList.add('linker-suffix-icon');
            return icon;
        }
        return null;
    }

    /////////////////////////////////////////////////
    // Filter and sort methods
    /////////////////////////////////////////////////

    static compare(a: VirtualMatch, b: VirtualMatch): number {
        if (a.from === b.from) {
            if (b.to == a.to) {
                return b.files.length - a.files.length;
            }
            return b.to - a.to;
        }
        return a.from - b.from;
    }

    static sort(matches: VirtualMatch[]): VirtualMatch[] {
        return Array.from(matches).sort(VirtualMatch.compare);
    }

    static filterAlreadyLinked(matches: VirtualMatch[], linkedFiles: Set<TFile>, mode: 'some' | 'every' = 'every'): VirtualMatch[] {
        return matches.filter((match) => {
            if (mode === 'every') {
                return !match.files.every((file) => linkedFiles.has(file));
            } else {
                return !match.files.some((file) => linkedFiles.has(file));
            }
        });
    }

    static filterOverlapping(matches: VirtualMatch[], onlyLinkOnce: boolean = true, excludedIntervalTree?: IntervalTree): VirtualMatch[] {
        const matchesToDelete: Map<number, boolean> = new Map();

        // Delete additions that overlap
        // Additions are sorted by from position and after that by length, we want to keep longer additions
        for (let i = 0; i < matches.length; i++) {
            const addition = matches[i];
            if (matchesToDelete.has(addition.id)) {
                continue;
            }

            // Check if the addition is inside an excluded block
            if (excludedIntervalTree) {
                const overlaps = excludedIntervalTree.search([addition.from, addition.to]);
                if (overlaps.length > 0) {
                    matchesToDelete.set(addition.id, true);
                    continue;
                }
            }

            // Set all overlapping additions to be deleted
            for (let j = i + 1; j < matches.length; j++) {
                const otherAddition = matches[j];
                if (otherAddition.from >= addition.to) {
                    break;
                }
                matchesToDelete.set(otherAddition.id, true);
            }

            // Set all additions that link to the same file to be deleted
            if (onlyLinkOnce) {
                for (let j = i + 1; j < matches.length; j++) {
                    const otherAddition = matches[j];
                    if (matchesToDelete.has(otherAddition.id)) {
                        continue;
                    }

                    if (otherAddition.files.every((f) => addition.files.contains(f))) {
                        matchesToDelete.set(otherAddition.id, true);
                    }
                }
            }
        }
        return matches.filter((match) => !matchesToDelete.has(match.id));
    }
}
