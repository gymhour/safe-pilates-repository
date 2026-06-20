import loginLogoDark from './assets/gymhour/logo_gymhour_sin_texto.png';
import loginLogoLight from './assets/gymhour/logo_gymhour_sin_texto_negro.png';
import sidebarLogoDark from './assets/gymhour/logo_gymhour.png';
import sidebarLogoLight from './assets/gymhour/logo_gymhour_black.png';
// import clientLogo from './assets/client/ag_entrenamiento.png';

const CLIENT_SETUP = {
  apiUrl: process.env.REACT_APP_API_URL || 'http://localhost:3000',

  branding: {
    name: 'GymHour',
    logoAlt: 'Logo del gimnasio',
    logos: {
      login: {
        dark: loginLogoDark,
        light: loginLogoLight,
        // Para usar un unico logo de cliente en ambos temas:
        // dark: clientLogo,
        // light: clientLogo,
      },
      sidebar: {
        dark: sidebarLogoDark,
        light: sidebarLogoLight,
        // Para usar un unico logo de cliente en ambos temas:
        // dark: clientLogo,
        // light: clientLogo,
      },
    },
    theme: {
      primaryColor: '#DA4632',
      primaryColorHover: '#ee452f',
      backgroundHoverColor: '#da463244',
      loginInputFocusShadowDark: '0 0 0 4px rgba(218, 70, 50, 0.16)',
      loginInputFocusShadowLight: '0 0 0 3px rgba(218, 70, 50, 0.15)',
    },
  },

  payment: {
    accountHolder: 'JUAN PEREZ',
    alias: 'gymhour.alias',
    cbu: '00700238-30004046522411',
    cuil: '20-35752545-5',
    whatsapp: {
      phoneNumber: '5493406423587',
      message: 'Hola AG Entrenamientos! Les comparto el comprobante de pago de este mes:',
    },
  },
};

export const getSetupLogo = (logoKey, theme = 'dark') => {
  const logos = CLIENT_SETUP.branding.logos[logoKey];
  if (!logos) return '';
  return theme === 'light' ? logos.light : logos.dark;
};

export const applyClientTheme = () => {
  const root = document.documentElement;
  const theme = CLIENT_SETUP.branding.theme;

  root.style.setProperty('--primary-color', theme.primaryColor);
  root.style.setProperty('--primary-color-hover', theme.primaryColorHover);
  root.style.setProperty('--background-hover-color', theme.backgroundHoverColor);

  const style = document.createElement('style');
  style.id = 'client-setup-theme';
  style.textContent = `
    [data-theme='dark'] {
      --login-input-focus-shadow: ${theme.loginInputFocusShadowDark};
    }

    [data-theme='light'] {
      --login-input-focus-shadow: ${theme.loginInputFocusShadowLight};
    }
  `;

  document.getElementById(style.id)?.remove();
  document.head.appendChild(style);
};

export const getPaymentWhatsappUrl = () => {
  const { phoneNumber, message } = CLIENT_SETUP.payment.whatsapp;
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
};

export default CLIENT_SETUP;
