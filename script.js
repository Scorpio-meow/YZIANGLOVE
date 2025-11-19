/**
 * Threads 精選貼文 - JavaScript 互動層
 * 功能：處理頁面互動、動態效果、使用者體驗優化
 */

// 等待 DOM 完全載入
document.addEventListener('DOMContentLoaded', function() {
    console.log('頁面已載入完成！');
    
    // 初始化所有功能
    initScrollAnimation();
    initCardInteractions();
    initThemeToggle();
    initBackToTop();
    
    // 載入 Threads 嵌入腳本
    loadThreadsEmbed();
});

/**
 * 滾動動畫效果
 */
function initScrollAnimation() {
    const cards = document.querySelectorAll('.card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    
    cards.forEach(card => {
        observer.observe(card);
    });
}

/**
 * 卡片互動效果
 */
function initCardInteractions() {
    const cards = document.querySelectorAll('.card');
    
    cards.forEach(card => {
        // 卡片的 hover 效果由 CSS 處理 (.card:hover)，無需在 JS 中使用 inline styles
        
        // 點擊效果
        card.addEventListener('click', function(e) {
            // 如果點擊的不是連結，則添加脈衝效果
            if (!e.target.closest('a')) {
                this.classList.add('pulse');
                setTimeout(() => {
                    this.classList.remove('pulse');
                }, 300);
            }
        });
    });
}

/**
 * 主題切換功能（淺色/深色模式）
 */
function initThemeToggle() {
    // 檢查是否有儲存的主題偏好
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    
    // 創建主題切換按鈕（如果需要的話）
    // 這裡可以添加主題切換按鈕的邏輯
}

/**
 * 返回頂部按鈕
 */
function initBackToTop() {
    // 創建返回頂部按鈕
    const backToTopBtn = document.createElement('button');
    backToTopBtn.innerHTML = '↑';
    backToTopBtn.className = 'back-to-top';
    backToTopBtn.setAttribute('aria-label', '返回頂部');
    // 樣式已移到 css（.back-to-top），此處只維持 class
    
    document.body.appendChild(backToTopBtn);
    
    // 滾動顯示/隱藏按鈕
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    });
    
    // 點擊返回頂部
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    
    // 懸停效果由 CSS :hover 處理（.back-to-top:hover）
}

/**
 * 載入 Threads 嵌入腳本
 */
function loadThreadsEmbed() {
    // 檢查腳本是否已經載入
    if (!document.querySelector('script[src="https://www.threads.com/embed.js"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.threads.com/embed.js';
        script.async = true;
        document.body.appendChild(script);
    }
}

/**
 * 卡片載入計數器
 */
function countLoadedCards() {
    const cards = document.querySelectorAll('.card');
    console.log(`總共載入了 ${cards.length} 張卡片`);
    return cards.length;
}

/**
 * 效能監控
 */
function logPerformance() {
    if (window.performance) {
        const perfData = window.performance.timing;
        const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
        console.log(`頁面載入時間: ${pageLoadTime}ms`);
    }
}

// 頁面載入完成後記錄效能
window.addEventListener('load', () => {
    setTimeout(() => {
        logPerformance();
        countLoadedCards();
    }, 100);
});

/**
 * 工具函數：節流
 */
function throttle(func, delay) {
    let timeoutId;
    let lastExecTime = 0;
    
    return function(...args) {
        const currentTime = Date.now();
        
        if (currentTime - lastExecTime < delay) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                lastExecTime = currentTime;
                func.apply(this, args);
            }, delay);
        } else {
            lastExecTime = currentTime;
            func.apply(this, args);
        }
    };
}

/**
 * 工具函數：防抖
 */
function debounce(func, delay) {
    let timeoutId;
    
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// 匯出函數供其他模組使用（如果需要）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        throttle,
        debounce,
        countLoadedCards
    };
}
