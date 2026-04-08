(function () {
  const storageKeys = {
    age: "igs_age_segment",
    settings: "igs_accessibility_settings",
    progress: "igs_progress",
    checklists: "igs_saved_checklists",
    events: "igs_events",
  };

  const defaultProgress = {
    completedScenarios: {},
    quizScores: {},
    badges: [],
  };

  let remoteAuthState = getBootstrap().auth || { authenticated: false, username: null };

  function safeJsonParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function formatSingleSentence(text) {
    if (typeof text !== "string") return text;
    const value = text.trim();
    if (!value) return value;
    if (!/[.!?]$/.test(value)) return value;
    const marks = value.match(/[.!?]/g) || [];
    return marks.length === 1 ? value.slice(0, -1) : value;
  }

  function dedupeLines(lines) {
    const seen = new Set();
    return (lines || []).filter((line) => {
      const normalized = String(line).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function getBootstrap() {
    return window.APP_BOOTSTRAP || { ageSegments: [], scenarios: [], basicsModules: [], auth: { authenticated: false, username: null } };
  }

  function hasMeaningfulProgress(progress) {
    return Boolean(progress && (Object.keys(progress.completedScenarios || {}).length || Object.keys(progress.quizScores || {}).length || (progress.badges || []).length));
  }

  function hasMeaningfulSettings(settings) {
    return Boolean(settings && (settings.largeText || settings.darkTheme));
  }

  function isAuthenticated() {
    return Boolean(remoteAuthState?.authenticated);
  }

  async function persistRemoteState(payload) {
    if (!isAuthenticated()) return;
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn("Remote state sync failed", error);
    }
  }

  function hydrateLocalStateFromRemote(data) {
    if (typeof data.ageSegment === "string" && data.ageSegment) {
      localStorage.setItem(storageKeys.age, data.ageSegment);
    }
    if (data.settings && typeof data.settings === "object") {
      localStorage.setItem(storageKeys.settings, JSON.stringify(data.settings));
    }
    if (data.progress && typeof data.progress === "object") {
      localStorage.setItem(storageKeys.progress, JSON.stringify(data.progress));
    }
    if (Array.isArray(data.checklists)) {
      localStorage.setItem(storageKeys.checklists, JSON.stringify(data.checklists.slice(0, 12)));
    }
  }

  async function initRemoteState() {
    try {
      const response = await fetch("/api/state", { credentials: "same-origin" });
      const data = await response.json();
      remoteAuthState = data;
      if (!data.authenticated) return;

      const localAge = getAgeSegment();
      const localSettings = getSettings();

      const remoteHasAge = Boolean(data.ageSegment);
      const remoteHasSettings = hasMeaningfulSettings(data.settings);
      const remoteHasProgress = hasMeaningfulProgress(data.progress);
      const remoteHasChecklists = Array.isArray(data.checklists) && data.checklists.length > 0;

      const mergedAge = remoteHasAge ? data.ageSegment : localAge;
      const mergedSettings = remoteHasSettings ? data.settings : localSettings;
      const mergedProgress = remoteHasProgress ? data.progress : defaultProgress;
      const mergedChecklists = remoteHasChecklists ? data.checklists : [];

      hydrateLocalStateFromRemote({
        ageSegment: mergedAge,
        settings: mergedSettings,
        progress: mergedProgress,
        checklists: mergedChecklists,
      });

      if (!remoteHasAge && localAge) {
        await persistRemoteState({ ageSegment: localAge });
      }
      if (!remoteHasSettings && hasMeaningfulSettings(localSettings)) {
        await persistRemoteState({ settings: localSettings });
      }
    } catch (error) {
      console.warn("Remote state init failed", error);
    }
  }

  function getSettings() {
    const stored = safeJsonParse(localStorage.getItem(storageKeys.settings), {});
    return {
      largeText: Boolean(stored.largeText),
      darkTheme: Boolean(stored.darkTheme || stored.highContrast),
    };
  }

  function saveSettings(settings) {
    localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
    void persistRemoteState({ settings });
  }

  function applySettings() {
    const settings = getSettings();
    document.documentElement.classList.toggle("is-large-text", settings.largeText);
    document.body.classList.toggle("is-dark-theme", settings.darkTheme);
    document.querySelectorAll('[data-action="toggle-font-size"]').forEach((button) => {
      button.classList.toggle("is-active", settings.largeText);
    });
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
      button.classList.toggle("is-active", settings.darkTheme);
    });
  }

  function getAgeSegment() {
    return localStorage.getItem(storageKeys.age);
  }

  function getAgeSegmentData() {
    const { ageSegments } = getBootstrap();
    return ageSegments.find((item) => item.id === getAgeSegment()) || null;
  }

  function getDisplayAgeSegment() {
    return getAgeSegmentData() || getBootstrap().ageSegments[0] || null;
  }

  function getAgeAvatarUrl(ageSegment) {
    return ageSegment?.avatar ? `/static/${ageSegment.avatar}` : "";
  }

  function setAgeSegment(segmentId) {
    localStorage.setItem(storageKeys.age, segmentId);
    void persistRemoteState({ ageSegment: segmentId });
    trackEvent("age_segment_selected", { segmentId });
    applyAgeModeUI();
    updateAdaptiveCopy();
    updateProfilePage();
    document.dispatchEvent(new CustomEvent("igs:age-changed"));
  }

  function getProgress() {
    return safeJsonParse(localStorage.getItem(storageKeys.progress), defaultProgress);
  }

  function saveProgress(progress) {
    localStorage.setItem(storageKeys.progress, JSON.stringify(progress));
    void persistRemoteState({ progress });
  }

  function getSavedChecklists() {
    return safeJsonParse(localStorage.getItem(storageKeys.checklists), []);
  }

  function saveChecklist(item) {
    const saved = getSavedChecklists();
    saved.unshift(item);
    const sliced = saved.slice(0, 12);
    localStorage.setItem(storageKeys.checklists, JSON.stringify(sliced));
    void persistRemoteState({ checklists: sliced });
  }

  function trackEvent(name, payload) {
    const events = safeJsonParse(localStorage.getItem(storageKeys.events), []);
    events.unshift({
      name,
      payload,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(storageKeys.events, JSON.stringify(events.slice(0, 80)));
  }

  function calculateBadges(progress) {
    const completed = Object.keys(progress.completedScenarios || {});
    const badges = [];
    if (completed.length >= 1) {
      badges.push("Я знаю разницу между риском и случаем");
    }
    if (completed.length >= 2) {
      badges.push("Я умею читать исключения");
    }
    if (completed.length >= 3) {
      badges.push("Я умею задавать правильные вопросы");
    }
    if (completed.length >= 5) {
      badges.push("Я уже уверенно ориентируюсь в сценариях");
    }
    if (Object.values(progress.quizScores || {}).some((score) => score >= 3)) {
      badges.push("Квиз пройден уверенно");
    }
    progress.badges = badges;
    saveProgress(progress);
    return badges;
  }

  function openAgeModal() {
    const modal = document.getElementById("age-modal");
    if (modal && typeof modal.showModal === "function") {
      if (!modal.open) modal.showModal();
    }
  }

  function closeAgeModal() {
    const modal = document.getElementById("age-modal");
    if (modal && modal.open) {
      modal.close();
    }
  }

  function applyAgeModeUI() {
    const ageSegment = getAgeSegmentData();
    const displaySegment = getDisplayAgeSegment();
    const agePill = document.getElementById("age-pill");

    if (agePill) {
      const label = ageSegment ? ageSegment.title : "Выбрать режим";
      const caption = ageSegment ? "Сменить режим" : "Подстроить под возраст";
      agePill.innerHTML = `
        <span class="age-pill__avatar" aria-hidden="true">
          ${displaySegment ? `<img src="${getAgeAvatarUrl(displaySegment)}" alt="">` : ""}
        </span>
        <span class="age-pill__copy">
          <strong>${label}</strong>
          <span>${caption}</span>
        </span>
      `;
    }

    document.querySelectorAll("[data-age-segment]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.ageSegment === ageSegment?.id);
    });
  }

  function updateAdaptiveCopy() {
    const ageSegment = getDisplayAgeSegment();
    if (!ageSegment) return;

    const heroText = document.getElementById("hero-text");
    const basicsHeroEyebrow = document.getElementById("basics-hero-eyebrow");
    const basicsHeroTitle = document.getElementById("basics-hero-title");
    const basicsHeroCopy = document.getElementById("basics-hero-copy");
    const basicsHeroAvatar = document.getElementById("basics-hero-avatar");

    if (heroText) {
      heroText.textContent = formatSingleSentence(ageSegment.home_hint);
    }

    if (basicsHeroEyebrow) {
      basicsHeroEyebrow.textContent = `Режим ${ageSegment.title}`;
    }

    if (basicsHeroTitle) {
      basicsHeroTitle.textContent = ageSegment.basics_title;
    }

    if (basicsHeroCopy) {
      basicsHeroCopy.textContent = formatSingleSentence(ageSegment.basics_hint);
    }

    if (basicsHeroAvatar) {
      basicsHeroAvatar.src = getAgeAvatarUrl(ageSegment);
      basicsHeroAvatar.alt = `Аватар режима ${ageSegment.title}`;
    }
  }

  function bindGlobalControls() {
    document.querySelectorAll('[data-action="toggle-font-size"]').forEach((button) => {
      button.addEventListener("click", () => {
        const settings = getSettings();
        settings.largeText = !settings.largeText;
        saveSettings(settings);
        applySettings();
      });
    });
    document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
      button.addEventListener("click", () => {
        const settings = getSettings();
        settings.darkTheme = !settings.darkTheme;
        saveSettings(settings);
        applySettings();
      });
    });
    document.querySelectorAll('[data-action="open-age-modal"]').forEach((button) => {
      button.addEventListener("click", openAgeModal);
    });
    document.querySelector('[data-action="skip-age-selection"]')?.addEventListener("click", closeAgeModal);
    document.querySelector('[data-action="close-age-modal"]')?.addEventListener("click", closeAgeModal);
    document.querySelectorAll("[data-age-segment]").forEach((button) => {
      button.addEventListener("click", () => {
        setAgeSegment(button.dataset.ageSegment);
        closeAgeModal();
      });
    });

    const ageModal = document.getElementById("age-modal");
    if (ageModal) {
      ageModal.addEventListener("click", (event) => {
        const dialogCard = ageModal.querySelector(".age-modal__card");
        if (!dialogCard) return;
        const rect = dialogCard.getBoundingClientRect();
        const isInDialog =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!isInDialog) {
          closeAgeModal();
        }
      });
    }
  }

  function maybeOpenOnboarding() {
    return;
  }

  function initScenarioCatalog() {
    const catalog = document.getElementById("scenario-catalog");
    const search = document.getElementById("scenario-search");
    const filterButtons = document.querySelectorAll("#scenario-filters [data-filter]");
    if (!catalog || !search || !filterButtons.length) return;

    let activeFilter = "all";
    const cards = Array.from(catalog.querySelectorAll(".scenario-card"));

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      cards.forEach((card) => {
        const matchesFilter = activeFilter === "all" || card.dataset.category === activeFilter;
        const matchesQuery =
          card.dataset.title.includes(query) ||
          card.textContent.toLowerCase().includes(query);
        card.hidden = !(matchesFilter && matchesQuery);
      });
    }

    filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter;
        filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
        applyFilters();
      });
    });

    search.addEventListener("input", applyFilters);
  }

  function initGlossarySearch() {
    const input = document.getElementById("glossary-search");
    const grid = document.getElementById("glossary-grid");
    if (!input || !grid) return;
    const cards = Array.from(grid.querySelectorAll(".glossary-card"));
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      cards.forEach((card) => {
        card.hidden = !card.dataset.term.includes(query);
      });
    });
  }

  function getScenarioFieldForAge(item, field) {
    const age = getAgeSegment();
    if (age === "11-13" && item[`kid_${field}`]) return item[`kid_${field}`];
    return item[field];
  }

  function updateScenarioCardCopies() {
    const scenarios = getBootstrap().scenarios || [];
    const scenarioMap = Object.fromEntries(scenarios.map((item) => [item.slug, item]));
    document.querySelectorAll("[data-scenario-slug]").forEach((card) => {
      const scenario = scenarioMap[card.dataset.scenarioSlug];
      if (!scenario) return;
      const copyNode = card.querySelector("[data-scenario-copy]");
      if (copyNode) {
        copyNode.textContent = formatSingleSentence(getScenarioFieldForAge(scenario, "card_copy"));
      }
    });
  }

  function updateGlossaryCards() {
    const script = document.getElementById("glossary-page-data");
    if (!script) return;
    const glossary = safeJsonParse(script.textContent, []);
    const glossaryMap = Object.fromEntries(glossary.map((item) => [item.id, item]));
    const isYoung = getAgeSegment() === "11-13";
    document.querySelectorAll("[data-glossary-id]").forEach((card) => {
      const item = glossaryMap[card.dataset.glossaryId];
      if (!item) return;
      const definitionNode = card.querySelector("[data-glossary-definition]");
      const exampleTitleNode = card.querySelector("[data-glossary-example-title]");
      const exampleNode = card.querySelector("[data-glossary-example]");
      if (definitionNode) {
        definitionNode.textContent = formatSingleSentence(isYoung && item.kid_definition ? item.kid_definition : item.definition);
      }
      if (exampleTitleNode) {
        exampleTitleNode.textContent = isYoung ? "Как это Лёва объяснил бы другу" : "Пример из жизни";
      }
      if (exampleNode) {
        exampleNode.textContent = formatSingleSentence(isYoung && item.kid_example ? item.kid_example : item.example);
      }
    });
  }

  function initBasicsModal() {
    const modal = document.getElementById("basics-modal");
    const contentNode = document.getElementById("basics-modal-content");
    if (!modal || !contentNode) return;

    const { basicsModules, ageSegments } = getBootstrap();

    function renderMythCards(module, activeTab) {
      if (activeTab === "11-13") {
        const myths = module.younger_myths || module.myths;
        return myths
          .map(
            (item) => `
              <article class="myth-card">
                <h3>Лёва сначала думал</h3>
                <p>${formatSingleSentence(item.myth)}</p>
                <h3>А потом Лёва понял</h3>
                <p>${formatSingleSentence(item.fact)}</p>
              </article>
            `,
          )
          .join("");
      }

      return module.myths
        .map(
          (item) => `
            <article class="myth-card">
              <h3>Часто кажется</h3>
              <p>${formatSingleSentence(item.myth)}</p>
              <h3>На деле</h3>
              <p>${formatSingleSentence(item.fact)}</p>
            </article>
          `,
        )
        .join("");
    }

    function renderModule(moduleId, forcedTab) {
      const module = basicsModules.find((item) => item.id === moduleId);
      if (!module) return;
      const activeTab = forcedTab || getAgeSegment() || "11-13";
      const currentSegment = ageSegments.find((item) => item.id === activeTab) || ageSegments[0];
      const currentMode =
        activeTab === "16-18" ? module.older_mode : activeTab === "14-15" ? module.middle_mode : module.younger_mode;
      const isYoung = activeTab === "11-13";
      const heroLead = isYoung ? currentMode.lead : module.modal_intro;
      const topCopy = isYoung ? currentMode.lead : module.modal_intro;
      const stepsTitle = isYoung ? "Как Лёва это объясняет" : "Главное по теме";
      const insightTitle = isYoung ? "Что Лёва понял" : "Что важно понять";
      const mythsTitle = isYoung ? "Где Лёва сначала путался" : "Что часто понимают не так";
      const actionsTitle = isYoung ? "Что Лёва запомнил" : "Коротко по делу";
      const actions = isYoung ? module.younger_actions || module.actions : module.actions;

      contentNode.innerHTML = `
        <div class="basics-modal__top">
          <div>
            <h2>${module.title}</h2>
            <p>${formatSingleSentence(topCopy)}</p>
          </div>
          <button type="button" class="secondary-button" data-action="close-basics-modal">Закрыть</button>
        </div>

        <div class="basics-modal__tabs">
          ${["11-13", "14-15", "16-18"]
            .map((tab) => {
              const segment = getBootstrap().ageSegments.find((item) => item.id === tab);
              return `
                <button type="button" class="basics-tab ${tab === activeTab ? "is-active" : ""}" data-basics-tab="${tab}" data-module-id="${module.id}">
                  ${segment ? segment.title : tab}
                </button>
              `;
            })
            .join("")}
        </div>

        <section class="basics-modal__hero">
          <div class="basics-modal__hero-media">
            ${currentSegment ? `<img src="${getAgeAvatarUrl(currentSegment)}" alt="Аватар режима ${currentSegment.title}">` : ""}
          </div>
          <div class="basics-modal__hero-copy">
            <p class="eyebrow">Режим ${currentSegment ? currentSegment.title : activeTab}</p>
            <p>${formatSingleSentence(heroLead)}</p>
          </div>
        </section>

        <div class="basics-modal__grid">
          <section class="basics-panel">
            <h3>${stepsTitle}</h3>
            <div class="basics-steps">
              ${currentMode.steps.map((step) => `<div class="basics-step">${formatSingleSentence(step)}</div>`).join("")}
            </div>
            <div class="tip-box">
              <strong>${insightTitle}</strong>
              <span>${formatSingleSentence(currentMode.feature_copy)}</span>
            </div>
          </section>
          <section class="basics-panel">
            <h3>${mythsTitle}</h3>
            <div class="myth-grid">
              ${renderMythCards(module, activeTab)}
            </div>
          </section>

          <section class="basics-panel">
            <h3>${actionsTitle}</h3>
            <div class="basics-steps">
              ${actions.map((action) => `<div class="basics-step">${formatSingleSentence(action)}</div>`).join("")}
            </div>
          </section>
        </div>
      `;

      contentNode.querySelector('[data-action="close-basics-modal"]')?.addEventListener("click", () => modal.close());
      contentNode.querySelectorAll("[data-basics-tab]").forEach((button) => {
        button.addEventListener("click", () => renderModule(module.id, button.dataset.basicsTab));
      });
    }

    document.querySelectorAll('[data-action="open-basics-modal"]').forEach((button) => {
      button.addEventListener("click", () => {
        renderModule(button.dataset.moduleId);
        modal.showModal();
        trackEvent("basics_module_opened", { moduleId: button.dataset.moduleId });
      });
    });

    modal.addEventListener("click", (event) => {
      const dialogCard = modal.querySelector(".basics-modal__card");
      if (!dialogCard) return;
      const rect = dialogCard.getBoundingClientRect();
      const isInDialog =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!isInDialog) {
        modal.close();
      }
    });
  }

  function renderScenarioApp() {
    const appNode = document.getElementById("scenario-app");
    const startButton = document.getElementById("start-scenario");
    const introCard = document.getElementById("scenario-intro-card");
    const scenarioScript = document.getElementById("scenario-data");
    const glossaryScript = document.getElementById("glossary-data");
    if (!appNode || !startButton || !introCard || !scenarioScript || !glossaryScript) return;

    const scenario = safeJsonParse(scenarioScript.textContent, null);
    const glossary = safeJsonParse(glossaryScript.textContent, []);
    if (!scenario) return;

    const glossaryMap = Object.fromEntries(glossary.map((item) => [item.id, item]));
    const state = {
      currentStep: 0,
      answers: [],
      coverageScore: 0,
      redFlags: [],
      documentHints: [],
    };

    const progressLabel = document.getElementById("scenario-progress-label");
    const progressFill = document.getElementById("scenario-progress-fill");
    const termHintCard = document.getElementById("term-hint-card");
    const introTitleNode = document.getElementById("scenario-intro-title");
    const introCopyNode = document.getElementById("scenario-intro-copy");
    const prepTitleNode = document.getElementById("scenario-prep-title");
    const prepCopyNode = document.getElementById("scenario-prep-copy");

    function updateProgressBar(value, total, label) {
      const percentage = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
      if (progressFill) progressFill.style.width = `${percentage}%`;
      if (progressLabel) progressLabel.textContent = label;
    }

    function updateTermHint(termId) {
      const term = glossaryMap[termId];
      if (!term || !termHintCard) return;
      termHintCard.innerHTML = `
        <h2>${term.term}</h2>
        <p>${formatSingleSentence(term.definition)}</p>
        <div class="tip-box">
          <strong>Пример из жизни</strong>
          <span>${formatSingleSentence(term.example)}</span>
        </div>
      `;
    }

    function getScenarioIntroContent() {
      const ageSegment = getAgeSegmentData();
      const base = {
        title: "Что случилось",
        intro: formatSingleSentence(getScenarioFieldForAge(scenario, "intro")),
        prepTitle: "Перед стартом",
        prepCopy: formatSingleSentence(scenario.prep_hint),
      };
      if (!ageSegment) return base;
      if (ageSegment.id === "11-13") {
        return {
          title: "Что случилось",
          intro: formatSingleSentence(getScenarioFieldForAge(scenario, "intro")),
          prepTitle: "Что лучше вспомнить",
          prepCopy: formatSingleSentence(scenario.kid_prep_hint || "Как всё случилось и есть ли фото, чек или другое подтверждение"),
        };
      }
      if (ageSegment.id === "14-15") {
        return {
          title: "Что случилось",
          intro: formatSingleSentence(scenario.intro),
          prepTitle: "Что лучше держать в голове",
          prepCopy: "Причину события, дату и документы, которые могут пригодиться",
        };
      }
      return {
        title: "Что случилось",
        intro: formatSingleSentence(scenario.intro),
        prepTitle: "Что лучше проверить сразу",
        prepCopy: "Причину события, документы и есть ли вообще подходящая защита",
      };
    }

    function updateScenarioIntroCard() {
      const content = getScenarioIntroContent();
      const pageLeadNode = document.getElementById("scenario-page-lead");
      const goalNode = document.getElementById("scenario-goal-copy");
      if (introTitleNode) introTitleNode.textContent = content.title;
      if (introCopyNode) introCopyNode.textContent = content.intro;
      if (prepTitleNode) prepTitleNode.textContent = content.prepTitle;
      if (prepCopyNode) prepCopyNode.textContent = content.prepCopy;
      if (pageLeadNode) pageLeadNode.textContent = content.intro;
      if (goalNode) goalNode.textContent = formatSingleSentence(getScenarioFieldForAge(scenario, "goal"));
    }

    function scoreProfile() {
      if (state.coverageScore >= 2) return { key: "positive", data: scenario.result_profiles.positive };
      if (state.coverageScore >= 0) return { key: "neutral", data: scenario.result_profiles.neutral };
      return { key: "negative", data: scenario.result_profiles.negative };
    }

    function verdictMeta(key) {
      if (key === "positive") {
        return {
          tone: "is-positive",
          label: "Есть признаки, что случай стоит проверять по полису",
          copy: "Это не обещание выплаты. Это сигнал, что есть смысл открыть договор и смотреть покрытие",
        };
      }
      if (key === "neutral") {
        return {
          tone: "is-neutral",
          label: "Нужна спокойная сверка условий и документов",
          copy: "Случай не выглядит провальным, но вывод зависит от деталей и формулировок в договоре",
        };
      }
      return {
        tone: "is-negative",
        label: "Похоже, это скорее не страховой сценарий",
        copy: "Здесь полезно понять границу страхования и не тратить силы на ложные ожидания",
      };
    }

    function buildAgeCoach() {
      const age = getAgeSegmentData();
      if (!age) return "";
      if (age.id === "11-13") return "Лёва бы сначала спокойно посмотрел, как именно это произошло";
      if (age.id === "14-15") return "Смотри на факты: что случилось и чем это можно подтвердить";
      return "Сначала факт события, потом документы и условия";
    }

    function renderStep() {
      const step = scenario.steps[state.currentStep];
      updateProgressBar(state.currentStep, scenario.steps.length, `Шаг ${state.currentStep + 1} из ${scenario.steps.length}`);
      const coachText = buildAgeCoach();
      appNode.innerHTML = `
        <div class="scenario-shell">
          <section class="scenario-question">
            <div class="scenario-question__header">
              <div>
                <h2>${step.question}</h2>
                ${coachText ? `<p class="muted">${coachText}</p>` : ""}
              </div>
            </div>
            <div class="scenario-options">
              ${step.options
                .map(
                  (option, index) => `
                    <button type="button" class="scenario-option" data-option-index="${index}">
                      ${formatSingleSentence(option.label)}
                    </button>
                  `,
                )
                .join("")}
            </div>
            <div id="feedback-slot"></div>
          </section>
        </div>
      `;

      appNode.querySelectorAll(".scenario-option").forEach((button) => {
        button.addEventListener("click", () => {
          const option = step.options[Number(button.dataset.optionIndex)];
          state.answers[state.currentStep] = option;
          state.coverageScore += option.coverage_delta || 0;
          if (option.red_flags) state.redFlags.push(...option.red_flags);
          if (option.document_hints) state.documentHints.push(...option.document_hints);

          appNode.querySelectorAll(".scenario-option").forEach((item) => item.classList.remove("is-selected"));
          button.classList.add("is-selected");

          updateTermHint(step.term_hint);
          trackEvent("scenario_answer_selected", {
            scenario: scenario.slug,
            step: step.id,
            answer: option.id,
          });

          const feedbackSlot = document.getElementById("feedback-slot");
          if (feedbackSlot) {
            feedbackSlot.innerHTML = `
              <article class="scenario-feedback">
                <strong>${formatSingleSentence(option.feedback)}</strong>
                <p class="scenario-feedback__details">${formatSingleSentence(option.details)}</p>
                <div class="action-row">
                  <button type="button" class="primary-button" id="next-step-button">
                    ${state.currentStep + 1 < scenario.steps.length ? "Дальше" : "Смотреть итог"}
                  </button>
                </div>
              </article>
            `;
          }

          document.getElementById("next-step-button")?.addEventListener("click", () => {
            state.currentStep += 1;
            if (state.currentStep < scenario.steps.length) {
              renderStep();
            } else {
              renderResult();
            }
          });
        });
      });
    }

    function renderResult() {
      const profile = scoreProfile();
      const verdict = verdictMeta(profile.key);
      updateProgressBar(scenario.steps.length, scenario.steps.length, `Шаг ${scenario.steps.length} из ${scenario.steps.length}`);

      const checklist = dedupeLines(scenario.result.checklist || []).slice(0, 5);
      const evidence = dedupeLines(state.documentHints).slice(0, 4);
      const warnings = dedupeLines(state.redFlags).slice(0, 4);

      appNode.innerHTML = `
        <section class="scenario-shell">
          <article class="story-card result-summary">
            <p class="eyebrow">Итог сценария</p>
            <h2>${formatSingleSentence(profile.data.headline)}</h2>
            <div class="chip-row">
              <span class="result-verdict ${verdict.tone}">${verdict.label}</span>
              <span class="chip">${scenario.category}</span>
            </div>
            <p>${formatSingleSentence(verdict.copy)}</p>
            <p>${formatSingleSentence(scenario.result.risk_explainer)}</p>
          </article>

          <div class="result-grid">
            <article class="result-card">
              <h3>Когда страхование может подключиться</h3>
              <ul>${scenario.result.help_block.map((item) => `<li>${formatSingleSentence(item)}</li>`).join("")}</ul>
            </article>
            <article class="result-card">
              <h3>Что часто ломает сценарий</h3>
              <ul>${scenario.result.exclusions.map((item) => `<li>${formatSingleSentence(item)}</li>`).join("")}</ul>
            </article>
            <article class="result-card">
              <h3>Что сделать сейчас</h3>
              <ul>${checklist.map((item) => `<li>${formatSingleSentence(item)}</li>`).join("")}</ul>
            </article>
            <article class="result-card">
              <h3>Какие доказательства пригодятся</h3>
              <ul>${(evidence.length ? evidence : ["Фото, чеки, справки и официальный след обращения"]).map((item) => `<li>${formatSingleSentence(item)}</li>`).join("")}</ul>
            </article>
            <article class="result-card">
              <h3>На что смотреть особенно внимательно</h3>
              <ul>${(warnings.length ? warnings : ["Сверь причину события с договором и не пропускай сроки обращения"]).map((item) => `<li>${formatSingleSentence(item)}</li>`).join("")}</ul>
            </article>
          </div>

          <div class="action-row">
            <button type="button" class="secondary-button" id="save-checklist-button">Сохранить памятку</button>
            <button type="button" class="primary-button" id="start-quiz-button">Проверь себя</button>
          </div>
        </section>
      `;

      document.getElementById("save-checklist-button")?.addEventListener("click", () => {
        saveChecklist({
          title: scenario.title,
          slug: scenario.slug,
          status: verdict.label,
          checklist,
          savedAt: new Date().toLocaleString("ru-RU"),
        });
        trackEvent("checklist_saved", { scenario: scenario.slug });
        const button = document.getElementById("save-checklist-button");
        if (button) {
          button.textContent = "Памятка сохранена";
          button.setAttribute("disabled", "disabled");
        }
      });

      document.getElementById("start-quiz-button")?.addEventListener("click", renderQuiz);
    }

    function renderQuiz() {
      let currentQuestion = 0;
      let score = 0;

      function renderQuestion() {
        const item = scenario.quiz[currentQuestion];
        updateProgressBar(currentQuestion, scenario.quiz.length, `Квиз ${currentQuestion + 1} из ${scenario.quiz.length}`);
        appNode.innerHTML = `
          <section class="quiz-card">
            <p class="eyebrow">Мини-квиз</p>
            <h2>${item.question}</h2>
            <div class="quiz-options">
              ${item.options
                .map(
                  (option, index) => `
                    <button type="button" class="quiz-option" data-quiz-index="${index}">
                      ${formatSingleSentence(option)}
                    </button>
                  `,
                )
                .join("")}
            </div>
            <div id="quiz-feedback"></div>
          </section>
        `;

        appNode.querySelectorAll(".quiz-option").forEach((button) => {
          button.addEventListener("click", () => {
            const selectedIndex = Number(button.dataset.quizIndex);
            const isCorrect = selectedIndex === item.answer;
            if (isCorrect) score += 1;

            appNode.querySelectorAll(".quiz-option").forEach((optionButton, index) => {
              optionButton.disabled = true;
              optionButton.classList.toggle("is-correct", index === item.answer);
              optionButton.classList.toggle("is-wrong", index === selectedIndex && !isCorrect);
            });

            const feedback = document.getElementById("quiz-feedback");
            if (feedback) {
              feedback.innerHTML = `
                <div class="scenario-feedback">
                  <strong>${isCorrect ? "Верно" : "Почти, давай поправим логику"}</strong>
                  <p>${isCorrect ? "Ты поймал(а) смысл сценария" : "Смотри на правильный вариант и запомни: сначала условия, потом вывод о страховом случае"}</p>
                  <div class="action-row">
                    <button type="button" class="primary-button" id="next-quiz-button">
                      ${currentQuestion + 1 < scenario.quiz.length ? "Следующий вопрос" : "Завершить сценарий"}
                    </button>
                  </div>
                </div>
              `;
            }

            document.getElementById("next-quiz-button")?.addEventListener("click", () => {
              currentQuestion += 1;
              if (currentQuestion < scenario.quiz.length) {
                renderQuestion();
              } else {
                finishScenario(score);
              }
            });
          });
        });
      }

      renderQuestion();
    }

    function finishScenario(score) {
      const progress = getProgress();
      progress.completedScenarios[scenario.slug] = {
        completedAt: new Date().toISOString(),
        title: scenario.title,
      };
      progress.quizScores[scenario.slug] = score;
      const badges = calculateBadges(progress);
      saveProgress(progress);
      trackEvent("scenario_completed", { scenario: scenario.slug, quizScore: score });
      updateProgressBar(scenario.quiz.length, scenario.quiz.length, `Квиз ${scenario.quiz.length} из ${scenario.quiz.length}`);

      const allScenarios = getBootstrap().scenarios || [];
      const nextScenario = allScenarios.find((item) => !progress.completedScenarios[item.slug] && item.slug !== scenario.slug);

      appNode.innerHTML = `
        <section class="story-card">
          <p class="eyebrow">Сценарий завершён</p>
          <h2>Сценарий пройден, выводы закреплены, логика стала понятнее</h2>
          <div class="chip-row">
            <span class="chip chip--accent">Квиз ${score} / ${scenario.quiz.length}</span>
            <span class="chip">Пройдено сценариев ${Object.keys(progress.completedScenarios).length}</span>
          </div>
          <p>Последний полученный бейдж: ${badges[badges.length - 1] || "Прогресс уже сохранён"}</p>
          <div class="action-row">
            ${nextScenario ? `<a class="primary-button" href="/scenarios/${nextScenario.slug}">Следующий сценарий: ${nextScenario.title}</a>` : `<a class="primary-button" href="/scenarios">Выбрать другой сценарий</a>`}
            <a class="secondary-button" href="/profile">Открыть профиль</a>
          </div>
        </section>
      `;
    }

    startButton.addEventListener("click", () => {
      introCard.hidden = true;
      appNode.hidden = false;
      trackEvent("scenario_started", { scenario: scenario.slug });
      renderStep();
    });

    updateScenarioIntroCard();
    document.addEventListener("igs:age-changed", updateScenarioIntroCard);
  }

  function updateProfilePage() {
    if (document.body.dataset.page !== "profile") return;
    const authenticated = isAuthenticated();
    const progress = getProgress();
    const scenarios = getBootstrap().scenarios || [];
    const completedCount = Object.keys(progress.completedScenarios || {}).length;
    const progressTitle = document.getElementById("profile-progress-title");
    const progressFill = document.getElementById("profile-progress-fill");
    const progressCopy = document.getElementById("profile-progress-copy");
    const badgeList = document.getElementById("badge-list");
    const savedChecklists = document.getElementById("saved-checklists");
    const ageTitle = document.getElementById("profile-age-title");
    const ageCopy = document.getElementById("profile-age-copy");
    const storageCopy = document.getElementById("profile-storage-copy");

    if (progressTitle) {
      progressTitle.textContent = `${completedCount} из ${scenarios.length} сценариев`;
    }
    if (progressFill) {
      const percentage = scenarios.length ? (completedCount / scenarios.length) * 100 : 0;
      progressFill.style.width = `${percentage}%`;
    }
    if (progressCopy) {
      progressCopy.textContent = completedCount
        ? authenticated
          ? "Прогресс сохранён в аккаунте и будет доступен после входа"
          : "Прогресс виден только в этом браузере и не привязан к аккаунту"
        : authenticated
          ? "Начни с любого сценария, и прогресс сохранится в аккаунте"
          : "Начни с любого сценария, чтобы здесь появился локальный прогресс";
    }
    if (storageCopy) {
      storageCopy.textContent = authenticated
        ? `Прогресс и памятки сохраняются в аккаунте ${remoteAuthState.username}`
        : "Без входа прогресс остаётся только в этом браузере, а памятки в аккаунте не сохраняются";
    }

    const badges = calculateBadges(progress);
    if (badgeList) {
      badgeList.innerHTML = badges.length
        ? badges.map((badge) => `<span class="badge">${badge}</span>`).join("")
        : `<div class="empty-state">Пока пусто. Первый бейдж появится после завершения сценария</div>`;
    }

    const matchedAge = getAgeSegmentData();
    if (ageTitle) {
      ageTitle.textContent = matchedAge ? matchedAge.title : "Не выбран";
    }
    if (ageCopy) {
      ageCopy.textContent = matchedAge ? formatSingleSentence(matchedAge.tone) : "Можно выбрать в настройках доступности на любой странице";
    }

    if (savedChecklists) {
      if (!authenticated) {
        savedChecklists.innerHTML = `
          <div class="empty-state">
            Войди в аккаунт, чтобы видеть и хранить памятки в профиле
          </div>
        `;
      } else {
        const items = getSavedChecklists();
        savedChecklists.innerHTML = items.length
          ? items
              .map(
                (item) => `
                  <article class="saved-item">
                    <div class="saved-item__meta">
                      <strong>${item.title}</strong>
                      <span>${item.savedAt}</span>
                    </div>
                    <p class="muted">${formatSingleSentence(item.status)}</p>
                    <ul class="bullet-list">
                      ${item.checklist.map((line) => `<li>${formatSingleSentence(line)}</li>`).join("")}
                    </ul>
                  </article>
                `,
              )
              .join("")
          : `<div class="empty-state">Сохрани памятку после любого сценария, и она появится здесь</div>`;
      }
    }
  }

  async function initApp() {
    await initRemoteState();
    applySettings();
    bindGlobalControls();
    applyAgeModeUI();
    updateAdaptiveCopy();
    maybeOpenOnboarding();
    initScenarioCatalog();
    initGlossarySearch();
    updateScenarioCardCopies();
    updateGlossaryCards();
    initBasicsModal();
    renderScenarioApp();
    updateProfilePage();
    document.addEventListener("igs:age-changed", () => {
      updateScenarioCardCopies();
      updateGlossaryCards();
    });
    trackEvent("app_open", { page: document.body.dataset.page });
  }

  void initApp();
})();
