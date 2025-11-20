(function appScope(global) {
    'use strict';

    const App = {};

    // 通用工具
    const scheduleMicrotask = typeof queueMicrotask === 'function' ? queueMicrotask : cb => Promise.resolve().then(cb);

    // SPA 路由系統
    (function() {
        const routes = {
            'home': { title: 'Threads 精選貼文', contentId: 'home-content' },
            'tech': { title: 'Threads 科技類別', contentId: 'tech-content' }
        };

        let currentRoute = 'home';

        function showContent(routeName) {
            const route = routes[routeName];
            if (!route) return;

            // 隱藏所有內容區塊
            Object.values(routes).forEach(r => {
                const el = document.getElementById(r.contentId);
                if (el) el.style.display = 'none';
            });

            // 顯示當前路由的內容
            const content = document.getElementById(route.contentId);
            if (content) {
                content.style.display = 'grid';
                // 重新觸發卡片動畫
                requestAnimationFrame(() => {
                    const cards = content.querySelectorAll('.card:not(.visible)');
                    cards.forEach(card => card.classList.add('visible'));
                });
            }

            // 更新導航高亮
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.toggle('active', link.dataset.route === routeName);
            });

            currentRoute = routeName;
        }

        function handleNavigation(routeName, updateHistory = true) {
            showContent(routeName);
            if (updateHistory) {
                const path = routeName === 'home' ? '/' : `/${routeName}`;
                history.pushState({ route: routeName }, '', path);
            }
            // 重新初始化視頻自動播放
            if (App.initVideoAutoplay) {
                scheduleMicrotask(() => App.initVideoAutoplay());
            }
        }

        App.initRouter = function() {
            // 處理導航連結點擊
            document.addEventListener('click', function(e) {
                const link = e.target.closest('a.nav-link');
                if (!link) return;
                e.preventDefault();
                const routeName = link.dataset.route;
                if (routeName && routeName !== currentRoute) {
                    handleNavigation(routeName, true);
                }
            });

            // 處理瀏覽器的前進/後退按鈕
            window.addEventListener('popstate', function(e) {
                const routeName = e.state?.route || 'home';
                handleNavigation(routeName, false);
            });

            // 初始化路由狀態
            const path = window.location.pathname;
            const initialRoute = path === '/tech' ? 'tech' : 'home';
            handleNavigation(initialRoute, false);
        };
    })();

    function throttle(fn, wait = 100) {
        let last = 0;
        let timeout;
        return function(...args) {
            const now = Date.now();
            const remaining = wait - (now - last);
            if (remaining <= 0) {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                last = now;
                fn.apply(this, args);
            } else if (!timeout) {
                timeout = setTimeout(() => {
                    last = Date.now();
                    timeout = null;
                    fn.apply(this, args);
                }, remaining);
            }
        };
    }

    function debounce(fn, wait = 100) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // 主題切換
    (function(){
        const THEME_KEY = 'theme';
        App.getTheme = () => {
            const stored = localStorage.getItem(THEME_KEY);
            if (stored) return stored;
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
            return 'light';
        };
        App.setTheme = (t) => {
            document.body.setAttribute('data-theme', t);
            localStorage.setItem(THEME_KEY, t);
        };

        App.toggleTheme = () => {
            const current = App.getTheme();
            App.setTheme(current === 'dark' ? 'light' : 'dark');
            renderThemeToggle();
        };

        function renderThemeToggle() {
            let btn = document.querySelector('.theme-toggle');
            if (!btn) return;
            const t = App.getTheme();
            btn.setAttribute('aria-pressed', t === 'dark');
            btn.title = t === 'dark' ? '切換到淺色模式' : '切換到深色模式';
        }

        // lazy-create UI if missing
        App.ensureThemeToggle = function() {
            if (document.querySelector('.theme-toggle')) return;
            const btn = document.createElement('button');
            btn.className = 'theme-toggle';
            btn.setAttribute('aria-label', '切換主題');
            btn.setAttribute('aria-pressed', App.getTheme() === 'dark');
            btn.innerHTML = '☾';
            btn.addEventListener('click', App.toggleTheme);
            // 放在 header 右上角（若有 header），否則放到 body
            const header = document.querySelector('.header');
            (header || document.body).appendChild(btn);
            scheduleMicrotask(renderThemeToggle);
        };
    })();

    // 回到頂端
    (function(){
        App.initBackToTop = function () {
            let btn = document.querySelector('.back-to-top');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'back-to-top';
                btn.setAttribute('aria-label', '返回頂部');
                btn.innerHTML = '↑';
                document.body.appendChild(btn);
            }
            const onScroll = throttle(() => {
                if (window.pageYOffset > 300) btn.classList.add('visible'); else btn.classList.remove('visible');
            }, 80);
            window.addEventListener('scroll', onScroll, { passive: true });
            btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        };
    })();

    // 卡片顯示 + 互動: 使用事件代理，減少事件數量
    App.initCardInteractions = function() {
        const grid = document.querySelector('.grid');
        if (!grid) return;
        grid.addEventListener('click', function(e) {
            const card = e.target.closest('.card');
            if (!card) return;
            // ignore link clicks
            if (e.target.closest('a')) return;
            card.classList.add('pulse');
            setTimeout(() => card.classList.remove('pulse'), 300);
        });
    };

    // 滾動顯示動畫(IntersectionObserver) - 優化版
    App.initScrollAnimation = function() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // 優化:顯示後取消觀察,減少性能開銷
                    observer.unobserve(entry.target);
                }
            });
        }, { 
            threshold: 0.12, 
            rootMargin: '0px 0px -48px 0px'
        });

        // 使用 requestAnimationFrame 批次處理
        requestAnimationFrame(() => {
            document.querySelectorAll('.card').forEach(card => observer.observe(card));
        });
    };

    // Video autoplay tracking (Shadow DOM aware)
    (function(){
        const pendingVideoRoots = new Set();
        const trackedVideoRoots = new Set();
        const videoRootObservers = new Map();
        let videoAutoplayReady = false;

        function trackVideoRoot(root) {
            if (!root || trackedVideoRoots.has(root) || typeof root.querySelectorAll !== 'function') return;
            trackedVideoRoots.add(root);
            scanVideosInRoot(root);
            const observer = new MutationObserver(debounce(() => scanVideosInRoot(root), 100));
            observer.observe(root, { childList: true, subtree: true });
            videoRootObservers.set(root, observer);
        }

        function scanVideosInRoot(root) {
            if (!root || typeof root.querySelectorAll !== 'function') return;
            const videos = root.querySelectorAll('video');
            videos.forEach(setupVideo);
        }

        function tryPlayVideo(video) {
            if (!video) return;
            const promise = video.play();
            if (promise && typeof promise.then === 'function') {
                promise.catch(() => {});
            }
        }

        function setupVideo(video) {
            if (typeof HTMLVideoElement !== 'undefined' && !(video instanceof HTMLVideoElement)) return;
            if (video.dataset.autoplaySetup) return;
            video.dataset.autoplaySetup = 'true';
            video.muted = true; video.defaultMuted = true; video.autoplay = true; video.playsInline = true; video.loop = true;
            ['pointerdown','touchstart','click'].forEach(evt => video.addEventListener(evt, () => tryPlayVideo(video), { once: true }));
            if (video.readyState >= 2) tryPlayVideo(video); else video.addEventListener('loadeddata', () => tryPlayVideo(video), { once: true });
        }

        // Hook Shadow DOM attach
        if (typeof Element !== 'undefined' && Element.prototype.attachShadow) {
            const original = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function(init) {
                const sr = original.call(this, init);
                const isOpen = !init || init.mode === 'open';
                if (isOpen) scheduleMicrotask(() => videoAutoplayReady ? trackVideoRoot(sr) : pendingVideoRoots.add(sr));
                return sr;
            };
        }

        App.initVideoAutoplay = function() {
            if (videoAutoplayReady) return;
            videoAutoplayReady = true;
            trackVideoRoot(document);
            if (pendingVideoRoots.size) { pendingVideoRoots.forEach(r => trackVideoRoot(r)); pendingVideoRoots.clear(); }
            // 優化:使用 requestIdleCallback 進行低優先級掃描
            const periodicScan = () => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(() => {
                        trackedVideoRoots.forEach(scanVideosInRoot);
                        setTimeout(periodicScan, 3000);
                    }, { timeout: 5000 });
                } else {
                    trackedVideoRoots.forEach(scanVideosInRoot);
                    setTimeout(periodicScan, 3000);
                }
            };
            periodicScan();
        };
    })();

    // 載入 Threads embed script (優化版)
    App.loadThreadsEmbed = function() {
        const selector = 'script[src="https://www.threads.com/embed.js"]';
        if (!document.querySelector(selector)) {
            const tag = document.createElement('script');
            tag.src = 'https://www.threads.com/embed.js';
            tag.async = true;
            tag.defer = true;
            tag.onload = () => {
                // 使用 requestIdleCallback 延遲非關鍵初始化
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(() => App.initVideoAutoplay(), { timeout: 1000 });
                } else {
                    setTimeout(App.initVideoAutoplay, 500);
                }
            };
            document.head.appendChild(tag);
        } else {
            App.initVideoAutoplay();
        }
    };

    // 效能/統計
    App.countLoadedCards = function() {
        const count = document.querySelectorAll('.card').length;
        console.log('載入卡片數：', count);
        return count;
    };

    App.logPerformance = function() {
        if (!window.performance || !window.performance.timing) return;
        const p = window.performance.timing; const t = p.loadEventEnd - p.navigationStart; console.log('頁面載入時間:', t, 'ms');
    };

    // 初始化入口
    document.addEventListener('DOMContentLoaded', function() {
        App.setTheme(App.getTheme());
        App.ensureThemeToggle();
        App.initBackToTop();
        App.initCardInteractions();
        App.initScrollAnimation();
        App.loadThreadsEmbed();
        App.initRouter(); // 初始化 SPA 路由
    });

    // Window load hooks
    window.addEventListener('load', () => {
        setTimeout(() => { App.logPerformance(); App.countLoadedCards(); }, 120);
    });

    // Export functions for testing if needed
    if (typeof module !== 'undefined' && module.exports) { module.exports = App; }
    global.App = App;
})(this);
