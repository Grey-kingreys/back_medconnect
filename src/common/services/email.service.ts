import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resendInstance: Resend | null = null;
  private fromEmail: string;

  constructor() {
    this.fromEmail =
      process.env.RESEND_FROM_EMAIL || 'MedConnecte <onboarding@resend.dev>';
  }

  /**
   * Init paresseux : le constructeur de Resend lève si la clé est absente.
   * L'instancier ici plutôt que dans le constructeur du service évite de faire
   * échouer le boot de toute l'application sur une dépendance d'envoi d'emails
   * (cf. audit #6). `validateEnv` signale déjà l'absence de clé au démarrage.
   */
  private get resend(): Resend {
    if (!this.resendInstance) {
      this.resendInstance = new Resend(process.env.RESEND_API_KEY);
    }
    return this.resendInstance;
  }

  /**
   * Envoie via Resend en respectant le contrat du SDK : `emails.send()` NE LÈVE PAS
   * sur une erreur d'API (domaine non vérifié, quota dépassé, adresse invalide…) —
   * il renvoie `{ data, error }`. Sans vérifier `error`, un échec d'envoi passait
   * totalement inaperçu (log « sent » trompeur, réponse 201). On transforme donc un
   * `error` en exception, que chaque appelant gère déjà (log `_failed`, et re-throw
   * lorsque l'envoi est critique).
   */
  private async deliver(
    payload: Parameters<Resend['emails']['send']>[0],
  ): Promise<void> {
    const { error } = await this.resend.emails.send(payload);
    if (error) {
      throw new Error(`${error.name ?? 'resend_error'}: ${error.message ?? 'échec inconnu'}`);
    }
  }

  // ─── Emails Auth ──────────────────────────────────────────────

  async sendWelcomeEmail(
    email: string,
    nom: string,
    prenom: string,
  ): Promise<void> {
    try {
      await this.deliver({
        from: this.fromEmail,
        to: email,
        subject: '🎉 Bienvenue sur MedConnecte !',
        html: this.buildLayout(
          'Bienvenue sur MedConnecte !',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Votre compte a été créé avec succès. Vous pouvez maintenant accéder à toutes les fonctionnalités de MedConnecte :</p>
          <ul>
            <li>Gérer votre carnet de santé numérique</li>
            <li>Localiser des services médicaux près de vous</li>
            <li>Consulter la disponibilité des médicaments</li>
            <li>Accéder à l'assistance IA en cas de besoin</li>
          </ul>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/auth/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      this.logger.error(`email.welcome_failed`, error instanceof Error ? error.stack : String(error));
    }
  }

  async sendPasswordResetEmail(
    email: string,
    nom: string,
    prenom: string,
    resetToken: string,
  ): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;
    try {
      await this.deliver({
        from: this.fromEmail,
        to: email,
        subject: '🔐 Réinitialisation de votre mot de passe — MedConnecte',
        html: this.buildLayout(
          'Réinitialisation de mot de passe',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${resetUrl}" style="${this.btnStyle('#dc2626')}">Réinitialiser mon mot de passe</a>
          </div>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Important :</strong> Ce lien est valide pendant <strong>1 heure</strong>.
            Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
          </div>
          <p>Lien direct : <a href="${resetUrl}" style="color:#2563eb;word-break:break-all">${resetUrl}</a></p>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      this.logger.error(`email.reset_failed`, error instanceof Error ? error.stack : String(error));
      throw new Error("Impossible d'envoyer l'email de réinitialisation");
    }
  }

  // ─── Email Alerte Sécurité (tentatives de connexion) ──────────

  async sendSuspiciousLoginEmail(
    email: string,
    nom: string,
    prenom: string,
    ip: string,
  ): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/auth/forgot-password`;
    try {
      await this.deliver({
        from: this.fromEmail,
        to: email,
        subject: '🔒 Tentatives de connexion suspectes — MedConnecte',
        html: this.buildLayout(
          'Alerte de sécurité',
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Nous avons détecté un nombre inhabituel de tentatives de connexion échouées
          sur votre compte. Par précaution, les connexions depuis cette source ont été
          temporairement bloquées.</p>
          <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Si ce n'était pas vous :</strong> votre mot de passe est peut-être
            la cible d'une attaque. Nous vous recommandons de le réinitialiser dès que possible.
          </div>
          <p style="font-size:13px;color:#64748b">Origine approximative : <code>${ip}</code></p>
          <div style="text-align:center;margin:30px 0">
            <a href="${resetUrl}" style="${this.btnStyle('#dc2626')}">Réinitialiser mon mot de passe</a>
          </div>
          <p>Si vous êtes à l'origine de ces tentatives (mot de passe oublié), vous pouvez
          ignorer cet email ; l'accès sera rétabli automatiquement après quelques minutes.</p>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      this.logger.error(`email.login_alert_failed`, error instanceof Error ? error.stack : String(error));
      // Non bloquant : l'échec d'envoi ne doit pas perturber le flux d'authentification.
    }
  }

  // ─── Email Invitation Structure ───────────────────────────────

  async sendStructureInviteEmail(
    email: string,
    structureNom: string,
    structureType: string,
    inviteToken: string,
  ): Promise<void> {
    const setupUrl = `${process.env.FRONTEND_URL}/auth/setup-structure/${inviteToken}`;
    const typeLabel = this.getTypeLabel(structureType);

    try {
      await this.deliver({
        from: this.fromEmail,
        to: email,
        subject: `🏥 Invitation — Configurez votre ${typeLabel} sur MedConnecte`,
        html: this.buildLayout(
          `Bienvenue sur MedConnecte`,
          `
          <p>Bonjour,</p>
          <p>Nous avons bien enregistré votre ${typeLabel} <strong>${structureNom}</strong> sur la plateforme <strong>MedConnecte</strong>.</p>
          <p>Pour finaliser la configuration de votre espace, cliquez sur le bouton ci-dessous :</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${setupUrl}" style="${this.btnStyle('#2563eb')}">Configurer mon espace</a>
          </div>
          <p>Vous pourrez :</p>
          <ul>
            <li>Créer votre mot de passe administrateur</li>
            <li>Compléter les informations de votre ${typeLabel}</li>
            <li>Ajouter vos médecins et membres du personnel</li>
          </ul>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:15px;margin:20px 0;border-radius:4px">
            <strong>⚠️ Ce lien expire dans 72 heures.</strong>
          </div>
          <p>Lien direct : <a href="${setupUrl}" style="color:#2563eb;word-break:break-all">${setupUrl}</a></p>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
      this.logger.log('email.invitation_sent');
    } catch (error) {
      this.logger.error(`email.invitation_failed`, error instanceof Error ? error.stack : String(error));
      throw new Error("Impossible d'envoyer l'email d'invitation");
    }
  }

  async sendMemberWelcomeEmail(
    email: string,
    nom: string,
    prenom: string,
    role: string,
    structureNom: string,
    temporaryPassword: string,
  ): Promise<void> {
    const roleLabel = this.getRoleLabel(role);
    try {
      await this.deliver({
        from: this.fromEmail,
        to: email,
        subject: `🏥 Votre compte ${roleLabel} sur MedConnecte — ${structureNom}`,
        html: this.buildLayout(
          `Votre compte MedConnecte`,
          `
          <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
          <p>Un compte <strong>${roleLabel}</strong> vous a été créé sur MedConnecte pour la structure <strong>${structureNom}</strong>.</p>
          <div style="background:#f0fdf4;border:1px solid #86efac;padding:20px;border-radius:8px;margin:20px 0">
            <p style="margin:0"><strong>Email :</strong> ${email}</p>
            <p style="margin:8px 0 0"><strong>Mot de passe temporaire :</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px">${temporaryPassword}</code></p>
          </div>
          <p>Connectez-vous et changez votre mot de passe dès que possible.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${process.env.FRONTEND_URL}/auth/login" style="${this.btnStyle('#2563eb')}">Se connecter</a>
          </div>
          <p>Cordialement,<br>L'équipe MedConnecte</p>
        `,
        ),
      });
    } catch (error) {
      this.logger.error(`email.member_failed`, error instanceof Error ? error.stack : String(error));
    }
  }

  // ─── Emails Urgence (SOS) ──────────────────────────────────────

  async sendEmergencyAlertEmail(
    contactEmail: string,
    contactNom: string,
    patientNom: string,
    patientPrenom: string,
    location?: { lat: number; lng: number },
    message?: string,
  ): Promise<void> {
    const mapsUrl = location 
      ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` 
      : null;

    try {
      await this.deliver({
        from: this.fromEmail, // Domaine vérifié (cf. RESEND_FROM_EMAIL) — sinon 403 Resend.
        to: contactEmail,
        subject: `🚨 ALERTE URGENCE : ${patientPrenom} ${patientNom} a besoin d'aide !`,
        html: this.buildLayout(
          `ALERTE URGENCE CRITIQUE`,
          `
          <div style="background:#fee2e2;border:2px solid #ef4444;padding:20px;border-radius:12px;margin-bottom:20px">
            <h2 style="color:#b91c1c;margin-top:0">⚠️ ALERTE SOS DÉCLENCHÉE</h2>
            <p style="font-size:16px;color:#7f1d1d">Bonjour <strong>${contactNom}</strong>,</p>
            <p style="font-size:18px;font-weight:bold;color:#b91c1c">
              ${patientPrenom} ${patientNom} vient de déclencher une alerte d'urgence vitale via MedConnecte.
            </p>
          </div>

          <div style="margin:20px 0;padding:15px;background:#f8fafb;border-radius:8px">
            <p style="margin:0 0 10px"><strong>Message d'urgence :</strong><br>${message || "Aucun message spécifié."}</p>
            ${mapsUrl ? `
              <p style="margin:20px 0;text-align:center">
                <a href="${mapsUrl}" style="${this.btnStyle('#dc2626')}">📍 Voir la position sur Maps</a>
              </p>
              <p style="font-size:12px;color:#64748b;text-align:center">
                Coordonnées : ${location!.lat.toFixed(6)}, ${location!.lng.toFixed(6)}
              </p>
            ` : '<p><em>Position non disponible</em></p>'}
          </div>

          <div style="background:#f1f5f9;padding:15px;border-radius:8px;margin-top:20px">
            <p style="margin:0;font-size:14px;color:#475569">
              <strong>Conseils :</strong><br>
              1. Essayez de contacter ${patientPrenom} immédiatement.<br>
              2. Appelez les services d'urgence (SAMU: 15) si vous ne parvenez pas à le joindre.<br>
              3. Dirigez-vous vers sa position si possible.
            </p>
          </div>
        `,
        ),
      });
      this.logger.log('email.sos_sent');
    } catch (error) {
      this.logger.error(`email.sos_failed`, error instanceof Error ? error.stack : String(error));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Coque HTML commune à tous les emails. Choix de design :
   * - Logo réel de la marque (fond transparent) posé sur une **carte blanche** —
   *   il ne ressortait pas sur l'ancien bandeau bleu. Servi via `FRONTEND_URL`
   *   (les data-URI/SVG sont bloqués par Gmail/Outlook → image hébergée obligatoire).
   * - Wordmark texte (plus d'emoji dans le titre) + filet dégradé aux teintes du logo.
   * - `preheader` : texte d'aperçu dans la boîte de réception (défaut = titre).
   * - Layout en `<table>` pour Outlook ; dark mode = on assombrit seulement le fond
   *   de page et on garde la carte blanche (évite d'inverser les couleurs sémantiques
   *   des encarts d'alerte/urgence).
   */
  private buildLayout(title: string, content: string, preheader = title): string {
    const logoUrl = `${process.env.FRONTEND_URL ?? ''}/images/logo.png`;
    const year = new Date().getFullYear();
    return `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="light dark">
          <meta name="supported-color-schemes" content="light dark">
          <title>${title}</title>
          <style>
            @media (prefers-color-scheme: dark) { .mc-bg { background:#0b1120 !important; } }
            a { text-decoration:none; }
          </style>
        </head>
        <body class="mc-bg" style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
          <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${preheader}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="mc-bg" style="background:#eef2f7">
            <tr>
              <td align="center" style="padding:32px 16px">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e9f0;border-radius:16px;overflow:hidden">
                  <tr>
                    <td style="padding:36px 32px 0;text-align:center;background:#ffffff">
                      <img src="${logoUrl}" width="56" height="56" alt="MedConnecte" style="display:block;margin:0 auto;width:56px;height:56px;border:0;outline:none">
                      <div style="margin-top:12px;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#0f172a">Med<span style="color:#2563eb">Connecte</span></div>
                      <div style="height:4px;width:64px;margin:20px auto 0;border-radius:2px;background:linear-gradient(90deg,#4f46e5,#0ea5a4,#16a34a)"></div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px 12px">
                      <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a">${title}</h1>
                      <div style="font-size:15px;line-height:1.65;color:#334155">${content}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:24px 32px;text-align:center;background:#f8fafc;border-top:1px solid #eef2f7">
                      <p style="margin:0;font-size:12px;color:#64748b">© ${year} MedConnecte — Plateforme de Santé Numérique</p>
                      <p style="margin:6px 0 0;font-size:12px;color:#94a3b8">Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private btnStyle(color: string): string {
    return `display:inline-block;padding:14px 34px;background:${color};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;line-height:1;box-shadow:0 1px 2px rgba(15,23,42,0.12)`;
  }

  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      HOPITAL: 'hôpital',
      CLINIQUE: 'clinique',
      PHARMACIE: 'pharmacie',
    };
    return labels[type] || type.toLowerCase();
  }

  private getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      MEDECIN: 'médecin',
      PHARMACIEN: 'pharmacien',
      STRUCTURE_ADMIN: 'administrateur',
    };
    return labels[role] || role.toLowerCase();
  }
}