// ULTRA-STRICT ACADEMIC JAVASCRIPT - NO ANIMATIONS, NO COLORS, NO EFFECTS

// Static initialization - NO animations
document.addEventListener('DOMContentLoaded', function() {
    // Centralized navigation behavior
    const navWrapper = document.querySelector('.nav-wrapper');
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const allNavLinks = document.querySelectorAll('.nav-wrapper a');

    // Handle mobile menu toggle
    if (mobileMenuToggle && navWrapper) {
        mobileMenuToggle.addEventListener('click', function() {
            navWrapper.classList.toggle('active');
        });
    }

    // Handle all navigation links
    if (allNavLinks) {
        allNavLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                // Close menu if it exists
                if (navWrapper) {
                    navWrapper.classList.remove('active');
                }

                // For anchor links (starting with #), scroll instantly
                const href = this.getAttribute('href');
                if (href && href.startsWith('#')) {
                    e.preventDefault();
                    const target = document.querySelector(href);
                    if (target) {
                        // Instant scroll, no smooth behavior
                        target.scrollIntoView({
                            behavior: 'auto',
                            block: 'start'
                        });
                    }
                }
                // For external links, let them work normally (menu already closed)
            });
        });
    }

    // Set scroll behavior to instant globally
    document.documentElement.style.scrollBehavior = 'auto';

    // Remove all smooth scrolling - use instant jump for any other anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                // NO smooth scrolling - instant jump only
                target.scrollIntoView({
                    behavior: 'auto',
                    block: 'start'
                });
            }
        });
    });

    // Render math equations if KaTeX is loaded - NO animations
    if (typeof katex !== 'undefined') {
        document.querySelectorAll('.math').forEach(element => {
            const math = element.textContent;
            try {
                katex.render(math, element, {
                    throwOnError: false,
                    displayMode: false
                });
            } catch (e) {
                // Silent fail - academic papers don't show errors
                console.log('Math rendering failed:', e);
            }
        });
    }

    // NO stat animations - values are already in HTML
    // NO hover effects
    // NO color transitions
    // NO transforms
    // NO interactive calculators

    // Simple code copy functionality - minimal UI
    document.querySelectorAll('pre code').forEach(block => {
        const button = document.createElement('button');
        button.style.cssText = 'position: absolute; top: 5px; right: 5px; background: #000; color: #fff; border: 1px solid #000; padding: 2px 5px; font-size: 10px; cursor: pointer;';
        button.textContent = 'Copy';
        button.addEventListener('click', function() {
            navigator.clipboard.writeText(block.textContent);
            button.textContent = 'Copied';
            setTimeout(() => {
                button.textContent = 'Copy';
            }, 1000);
        });

        // Only add button if parent is positioned
        const parent = block.parentNode;
        if (parent.tagName === 'PRE') {
            parent.style.position = 'relative';
            parent.appendChild(button);
        }
    });

    // Remove any existing canvas elements (graphs/charts)
    document.querySelectorAll('canvas').forEach(canvas => {
        // Replace with static table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; margin: 20px 0;';
        table.innerHTML = `
            <thead>
                <tr style="border-bottom: 2px solid #000;">
                    <th style="padding: 10px; text-align: left;">Protocol</th>
                    <th style="padding: 10px; text-align: right;">Cost (USD)</th>
                    <th style="padding: 10px; text-align: right;">Reduction</th>
                </tr>
            </thead>
            <tbody>
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 10px;">Traditional</td>
                    <td style="padding: 10px; text-align: right;">$25,000</td>
                    <td style="padding: 10px; text-align: right;">0%</td>
                </tr>
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 10px;">BRC-20</td>
                    <td style="padding: 10px; text-align: right;">$10,000</td>
                    <td style="padding: 10px; text-align: right;">60%</td>
                </tr>
                <tr style="border-bottom: 1px solid #ccc;">
                    <td style="padding: 10px;">GBRC-721</td>
                    <td style="padding: 10px; text-align: right;">$5,000</td>
                    <td style="padding: 10px; text-align: right;">80%</td>
                </tr>
                <tr style="border-bottom: 2px solid #000;">
                    <td style="padding: 10px; font-weight: bold;">Sparkle Protocol</td>
                    <td style="padding: 10px; text-align: right; font-weight: bold;">$1,000</td>
                    <td style="padding: 10px; text-align: right; font-weight: bold;">96%</td>
                </tr>
            </tbody>
        </table>
        `;
        canvas.parentNode.replaceChild(table, canvas);
    });

    // Remove any animation classes
    document.querySelectorAll('.animate, .animated, .fade-in, .slide-up').forEach(el => {
        el.classList.remove('animate', 'animated', 'fade-in', 'slide-up');
    });

    // Disable all CSS animations via style injection
    const style = document.createElement('style');
    style.textContent = `
        * {
            animation: none !important;
            transition: none !important;
            transform: none !important;
        }
    `;
    document.head.appendChild(style);
});

// Ensure no animations on page visibility change
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        // Remove any animation classes that might have been added
        document.querySelectorAll('[class*="animate"]').forEach(el => {
            Array.from(el.classList).forEach(className => {
                if (className.includes('animate')) {
                    el.classList.remove(className);
                }
            });
        });
    }
});

// Override any third-party animation libraries
if (typeof window !== 'undefined') {
    // Disable AOS (Animate On Scroll)
    if (window.AOS) {
        window.AOS = { init: function() {} };
    }

    // Disable ScrollReveal
    if (window.ScrollReveal) {
        window.ScrollReveal = function() { return { reveal: function() {} }; };
    }

    // Disable Wow.js
    if (window.WOW) {
        window.WOW = function() { return { init: function() {} }; };
    }

    // Disable GSAP
    if (window.gsap) {
        window.gsap = { to: function() {}, from: function() {}, timeline: function() {} };
    }
}

// Remove Mermaid diagrams - replace with text descriptions
if (typeof mermaid !== 'undefined') {
    mermaid.initialize = function() {};
}