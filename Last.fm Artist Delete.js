// ==UserScript==
// @name         Last.fm Super Easy Artist Delete 
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Simple delete buttons on Last.fm artist library pages
// @match        *://*.last.fm/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let scanTimeout = null;

    // Extract username from current page URL
    function getUsername() {
        const match = window.location.pathname.match(/^\/user\/([^/]+)/);
        return match ? match[1] : null;
    }

    // Normalize artist name: lowercase, remove emoji, replace non-alphanumeric with spaces
    function normalize(str) {
        return str
            .toLowerCase()
            .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
            .replace(/[^a-z0-9]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Add delete buttons to artist rows
    function addDeleteButtons() {
        const username = getUsername();
        if (!username) return;

        const rows = document.querySelectorAll('tr');

        rows.forEach(row => {
            const nameEl =
                row.querySelector('.chartlist-name') ||
                row.querySelector('td.chartlist-name') ||
                row.querySelector('a[href*="/music/"]');

            if (!nameEl) return;

            // Skip if delete button already exists
            if (row.querySelector('.lf-del-btn')) return;

            const artistText = (nameEl.textContent || nameEl.innerText || '').trim();
            if (!artistText) return;

            // Create delete button
            const btn = document.createElement('button');
            btn.textContent = '🗑';
            btn.className = 'lf-del-btn';

            Object.assign(btn.style, {
                marginRight: '6px',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                color: 'red',
                fontSize: '14px',
                padding: '0 4px',
                zIndex: '10',
                flexShrink: '0'
            });

            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                openDeleteModal(username, artistText);
            };

            // Prepend button to the left instead of appending to the right
            nameEl.insertBefore(btn, nameEl.firstChild);
        });
    }

    // Debounced add delete buttons
    function debouncedAddDeleteButtons() {
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(addDeleteButtons, 500);
    }

    // Open AJAX delete modal
    async function openDeleteModal(username, artistName) {
        const encoded = encodeURIComponent(artistName.trim()).replace(/%20/g, '+');
        const deleteUrl = `/user/${username}/library/music/${encoded}/+delete?is_modal=1&ajax=1`;

        try {
            const response = await fetch(deleteUrl, {
                credentials: 'include',
                headers: {
                    'Accept': 'text/html'
                }
            });

            if (!response.ok) {
                alert(`Failed to open delete modal: ${response.status}`);
                return;
            }

            const html = await response.text();

            // Parse HTML to extract csrf token and form action
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const csrfInput = doc.querySelector('input[name="csrfmiddlewaretoken"]');
            const confirmCheckbox = doc.querySelector('input[name="confirm"]');
            const form = doc.querySelector('form');

            if (!csrfInput) {
                alert('Could not parse delete form');
                return;
            }

            const csrfToken = csrfInput.value;
            const formAction = form ? form.getAttribute('action') : deleteUrl;

            // Create modal overlay
            const overlay = document.createElement('div');
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                right: '0',
                bottom: '0',
                background: 'rgba(0,0,0,0.5)',
                zIndex: 2147483646,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                fontFamily: 'sans-serif'
            });

            // Create modal content div
            const modal = document.createElement('div');
            Object.assign(modal.style, {
                background: '#fff',
                padding: '20px',
                borderRadius: '8px',
                maxWidth: '500px',
                width: '90%',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            });

            modal.innerHTML = html;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Handle form submission
            const submitBtn = modal.querySelector('button[type="submit"]');
            const cancelBtn = modal.querySelector('button.js-close');
            const formCheckbox = modal.querySelector('input[name="confirm"]');

            // Hijack cancel button to close overlay
            if (cancelBtn) {
                cancelBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    overlay.remove();
                };
            }

            // Disable submit button by default if checkbox not checked
            if (submitBtn && formCheckbox) {
                submitBtn.disabled = !formCheckbox.checked;
                submitBtn.style.opacity = formCheckbox.checked ? '1' : '0.5';
                submitBtn.style.cursor = formCheckbox.checked ? 'pointer' : 'not-allowed';

                // Update button state when checkbox changes
                formCheckbox.addEventListener('change', () => {
                    submitBtn.disabled = !formCheckbox.checked;
                    submitBtn.style.opacity = formCheckbox.checked ? '1' : '0.5';
                    submitBtn.style.cursor = formCheckbox.checked ? 'pointer' : 'not-allowed';
                });
            }

            if (submitBtn) {
                submitBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const confirmed = formCheckbox ? formCheckbox.checked : false;

                    // Require checkbox to be checked
                    if (!confirmed) {
                        alert('Please check the confirmation box');
                        return;
                    }

                    try {
                        const deleteResponse = await fetch(formAction, {
                            method: 'POST',
                            credentials: 'include',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: `csrfmiddlewaretoken=${encodeURIComponent(csrfToken)}&confirm=${confirmed ? 'on' : 'off'}&ajax=1`
                        });

                        if (deleteResponse.ok) {
                            // Show success message
                            modal.innerHTML = `
                                <div style="text-align: center; padding: 40px;">
                                    <h2 style="color: #28a745; margin-bottom: 20px;">✓ Artist Deleted</h2>
                                    <p style="font-size: 14px; color: #666;">The artist has been successfully removed from your library.</p>
                                </div>
                            `;
                            
                            // Close after 2 seconds
                            setTimeout(() => {
                                overlay.remove();
                                // Refresh after deletion
                                setTimeout(() => {
                                    debouncedAddDeleteButtons();
                                }, 500);
                            }, 2000);
                        } else {
                            alert('Delete request failed');
                        }
                    } catch (err) {
                        console.error('Delete error:', err);
                        alert(`Delete failed: ${err.message}`);
                    }
                };
            }

            // Close modal on background click
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            };

            // Close modal on ESC key
            const closeOnEscape = (e) => {
                if (e.key === 'Escape') {
                    overlay.remove();
                    document.removeEventListener('keydown', closeOnEscape);
                }
            };
            document.addEventListener('keydown', closeOnEscape);

        } catch (err) {
            console.error('Modal fetch error:', err);
            alert(`Failed to open delete modal: ${err.message}`);
        }
    }

    // ----------------------------
    // INITIALIZATION
    // ----------------------------

    console.log('[Last.fm Delete Script] Initializing...');

    // Initial scan
    setTimeout(() => {
        console.log('[Last.fm Delete Script] Adding delete buttons (500ms delay)');
        addDeleteButtons();
    }, 500);

    // Scan on page load completion
    window.addEventListener('load', () => {
        console.log('[Last.fm Delete Script] Window loaded event fired');
        setTimeout(() => {
            console.log('[Last.fm Delete Script] Adding delete buttons on window load (1s delay)');
            addDeleteButtons();
        }, 1000);
    });

    // Also scan when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[Last.fm Delete Script] DOM content loaded');
            setTimeout(() => {
                console.log('[Last.fm Delete Script] Adding delete buttons on DOMContentLoaded (500ms delay)');
                addDeleteButtons();
            }, 500);
        });
    }

    // MutationObserver to handle dynamically loaded content
    const observer = new MutationObserver(() => {
        debouncedAddDeleteButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
